/**
 * NEXTEХ (Nexora Texter) — Worker Runtime (Fase 4.10-E)
 * Runtime autónomo, seguro, multi-tenant y tolerante a fallos para ejecución de JobRuns.
 * 
 * RESPONSABILIDADES:
 * 1. Ciclo de vida del worker (STARTING -> HEALTHY -> DRAINING -> STOPPED / QUARANTINED / STALE).
 * 2. Integración estricta con Dispatcher y Control Plane (claim -> lease -> fencing).
 * 3. Ejecución durable y desacoplada de JobRuns (AgentRuntime, Steps, ToolExecutor).
 * 4. Fencing barrier autoritativo pre-ejecución y pre-efectos.
 * 5. Gestión de Human-in-the-Loop (HITL) con suspensión limpia y liberación de lease.
 * 6. Detección y manejo de cancelación cooperativa (cancellation_requested).
 * 7. Clasificación estricta de errores (retryable vs non-retryable).
 * 8. Parada ordenada (Graceful Shutdown) con drenado de concurrencia y release de leases.
 * 9. Observabilidad contextual y correlación de trazas sin fugas de secretos.
 */

import { randomUUID } from "crypto";
import {
  Worker,
  WorkerStatus,
  WorkerCapability,
  WorkerLease,
  JobRunDispatchEvent,
  WorkerRuntimeConfig,
  JobExecutionResult,
  ControlPlaneError,
  DrainWorkerResult,
} from "./types";
import { WorkerRegistry } from "./WorkerRegistry";
import { defaultAgentRuntime } from "@/lib/agents/runtime/runtime";
import { defaultJobQueue } from "@/lib/jobs/queue/queue";
import { defaultPolicyEngine } from "@/lib/agents/governance/policies";
import { defaultToolExecutor } from "@/lib/agents/tools/executor";
import { AgentError, AgentErrorCodes } from "@/lib/agents/types/errors";
import { Agent } from "@/lib/agents/types";
import { tracer } from "@/lib/observability/tracer";
import { ObservabilityContext } from "@/lib/observability/context";

interface ActiveJobContext {
  jobRunId: string;
  lease: WorkerLease;
  fencingToken: bigint | number;
  abortController: AbortController;
  startedAt: string;
}

export class WorkerRuntime {
  public readonly workerIdentity: string;
  public readonly instanceIdentity: string;
  public readonly workspaceId: string;
  public readonly version: string;
  public readonly capabilities: WorkerCapability[];
  public readonly maxConcurrency: number;

  private status: WorkerStatus = "STARTING";
  private workerId: string | null = null;
  private readonly registry: WorkerRegistry;
  private readonly supabaseClient: any;
  private readonly agentRuntime: any;
  private readonly jobQueue: any;
  private readonly policyEngine: any;
  private readonly toolExecutor: any;

  private activeJobs: Map<string, ActiveJobContext> = new Map();
  private heartbeatIntervalMs: number;
  private isRunning = false;
  private heartbeatAbortController: AbortController | null = null;
  private lifecycleAbortController: AbortController = new AbortController();

  constructor(config: WorkerRuntimeConfig) {
    if (!config.workspaceId) {
      throw new ControlPlaneError("workspaceId es obligatorio para inicializar el WorkerRuntime", "PERMANENT");
    }
    if (!config.workerIdentity) {
      throw new ControlPlaneError("workerIdentity es obligatorio para inicializar el WorkerRuntime", "PERMANENT");
    }

    this.workspaceId = config.workspaceId;
    this.workerIdentity = config.workerIdentity;
    this.version = config.version || "1.0.0";
    this.capabilities = config.capabilities || ["ai", "database", "integrations", "http"];
    this.maxConcurrency = config.maxConcurrency || 5;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs || 15000;

    this.supabaseClient = config.supabaseClient;
    this.registry = new WorkerRegistry(this.supabaseClient);
    this.instanceIdentity = config.instanceIdentity || this.registry.generateInstanceIdentity(this.workerIdentity);

    this.agentRuntime = config.agentRuntime || defaultAgentRuntime;
    this.jobQueue = config.jobQueue || defaultJobQueue;
    this.policyEngine = config.policyEngine || defaultPolicyEngine;
    this.toolExecutor = config.toolExecutor || defaultToolExecutor;
  }

  /**
   * Inicializa el Worker Runtime, registrándolo en el WorkerRegistry y arrancando latidos periódicos.
   */
  public async start(abortSignal?: AbortSignal): Promise<Worker> {
    if (this.isRunning && this.status === "HEALTHY") {
      const existing = await this.registry.getWorker(this.workerId!);
      if (existing) return existing;
    }

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        this.stop().catch(() => {});
      }, { once: true });
    }

    // 1. Registro formal ante el Control Plane
    const regResult = await this.registry.register({
      workspaceId: this.workspaceId,
      workerIdentity: this.workerIdentity,
      instanceIdentity: this.instanceIdentity,
      version: this.version,
      capabilities: this.capabilities,
      maxConcurrency: this.maxConcurrency,
    });

    if (!regResult.success || !regResult.worker) {
      const err = ControlPlaneError.classify({
        code: regResult.error_code || "WORKER_REGISTRATION_FAILED",
        message: regResult.error_message || "Fallo al registrar worker en control plane",
      });
      this.status = "STOPPED";
      throw err;
    }

    this.workerId = regResult.worker.id;
    this.status = regResult.worker.status;
    this.isRunning = true;

    // 2. Iniciar Heartbeat secuencial no superpuesto
    this.startHeartbeatLoop();

    return regResult.worker;
  }

  /**
   * Obtiene el estado operativo actual del Worker.
   */
  public getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Obtiene el ID asignado por el Control Plane al worker.
   */
  public getWorkerId(): string | null {
    return this.workerId;
  }

  /**
   * Obtiene la cantidad de jobs que se están ejecutando concurrentemente.
   */
  public getActiveConcurrency(): number {
    return this.activeJobs.size;
  }

  /**
   * Aborta cooperativamente un JobRun activo en vuelo (G5).
   */
  public abortJob(jobRunId: string, reason: string = "Cancelación solicitada"): boolean {
    const ctx = this.activeJobs.get(jobRunId);
    if (ctx) {
      ctx.abortController.abort(new Error(reason));
      return true;
    }
    return false;
  }

  /**
   * Conecta este runtime a un Dispatcher para recepción automática de eventos de despacho.
   */
  public attachToDispatcher(dispatcher: any): void {
    if (typeof dispatcher?.onDispatch === "function") {
      dispatcher.onDispatch(async (event: JobRunDispatchEvent) => {
        await this.execute(event);
      });
    }
  }

  /**
   * Ejecuta un JobRun entregado por el Dispatcher bajo cercado autoritativo de fencing token.
   */
  public async execute(event: JobRunDispatchEvent): Promise<JobExecutionResult> {
    const { jobRun, lease, fencingToken } = event;

    // =========================================================================
    // GUARDAS PREVIAS Y FENCING BARRIERS (E2 & E7)
    // =========================================================================

    // 1. Worker debe estar estrictamente HEALTHY
    if (this.status !== "HEALTHY") {
      throw new ControlPlaneError(
        `Worker '${this.workerIdentity}' no puede procesar jobs en estado '${this.status}'`,
        this.status === "QUARANTINED" ? "QUARANTINE" : "PERMANENT"
      );
    }

    // 2. Aislamiento Multi-Tenant Estricto
    if (jobRun.workspace_id !== this.workspaceId || lease.workspace_id !== this.workspaceId) {
      throw new ControlPlaneError(
        `Violación de frontera de tenant (Worker ws: '${this.workspaceId}' vs Job ws: '${jobRun.workspace_id}')`,
        "AUTHORIZATION"
      );
    }

    // 3. Validez de Lease y Fencing Token
    if (lease.status !== "active" || (lease.expires_at && new Date(lease.expires_at).getTime() <= Date.now())) {
      throw new ControlPlaneError(
        `Lease '${lease.id}' inválido o expirado para JobRun '${jobRun.id}'`,
        "FENCING"
      );
    }

    if (fencingToken === undefined || fencingToken === null) {
      throw new ControlPlaneError(
        `Fencing token ausente en despacho de JobRun '${jobRun.id}'`,
        "FENCING"
      );
    }

    if (
      lease.fencing_token !== undefined &&
      lease.fencing_token !== null &&
      BigInt(fencingToken) < BigInt(lease.fencing_token)
    ) {
      throw new ControlPlaneError(
        `Fencing token obsoleto (${fencingToken} < ${lease.fencing_token}) para JobRun '${jobRun.id}'`,
        "FENCING"
      );
    }

    if (
      jobRun.fencing_token !== undefined &&
      jobRun.fencing_token !== null &&
      BigInt(fencingToken) < BigInt(jobRun.fencing_token)
    ) {
      throw new ControlPlaneError(
        `Fencing token obsoleto respecto a JobRun (${fencingToken} < ${jobRun.fencing_token})`,
        "FENCING"
      );
    }

    // 4. Límite de Capacidad Local
    if (this.activeJobs.size >= this.maxConcurrency) {
      throw new ControlPlaneError(
        `Capacidad local máxima alcanzada (${this.maxConcurrency}) en worker '${this.workerIdentity}'`,
        "CAPACITY"
      );
    }

    // 5. Detección Temprana de Cancelación (E9)
    if (jobRun.status === "cancellation_requested" || jobRun.status === "cancelled") {
      await this.handleCancellation(jobRun, lease, fencingToken);
      return {
        success: false,
        status: "cancelled",
        runId: jobRun.id,
        fencingToken,
        error: "JobRun cancelado antes de iniciar ejecución",
      };
    }

    // Registrar en activeJobs
    const jobAbortController = new AbortController();
    const jobContext: ActiveJobContext = {
      jobRunId: jobRun.id,
      lease,
      fencingToken,
      abortController: jobAbortController,
      startedAt: new Date().toISOString(),
    };
    this.activeJobs.set(jobRun.id, jobContext);

    // Instrumentar Observabilidad (E12)
    const traceSpan = tracer.startSpan({
      name: "worker.execute_job_run",
      component: "worker_runtime",
      spanType: "job",
      workspaceId: this.workspaceId,
      jobId: jobRun.job_id,
      jobRunId: jobRun.id,
      agentId: jobRun.agent_id,
      attributes: {
        worker_id: this.workerId || "",
        worker_identity: this.workerIdentity,
        instance_identity: this.instanceIdentity,
        fencing_token: Number(fencingToken),
      },
    });

    return ObservabilityContext.run(
      {
        traceId: traceSpan.traceId,
        spanId: traceSpan.spanId,
        workspaceId: this.workspaceId,
      },
      async () => {
        try {
          // Actualizar estado del JobRun a 'running' en base de datos si estaba en 'claimed'
          if (this.supabaseClient && jobRun.status === "claimed") {
            await (this.supabaseClient.from("job_runs") as any)
              .update({ status: "running", started_at: new Date().toISOString() })
              .eq("id", jobRun.id)
              .eq("workspace_id", this.workspaceId);
          }

          // JIT Validación de Agente y Políticas (E4)
          let agentData: any = null;
          if (this.supabaseClient) {
            const { data, error: agErr } = await (this.supabaseClient.from("agents") as any)
              .select("*, agent_tools(tool_id, enabled)")
              .eq("id", jobRun.agent_id)
              .eq("workspace_id", this.workspaceId)
              .maybeSingle();

            if (agErr || !data) {
              throw new AgentError({
                code: AgentErrorCodes.AGENT_NOT_FOUND,
                message: `El agente '${jobRun.agent_id}' no existe o no pertenece al workspace.`,
                statusCode: 404,
              });
            }
            agentData = data;
          } else {
            agentData = {
              id: jobRun.agent_id,
              workspace_id: this.workspaceId,
              name: "Mock Agent",
              status: "active",
              max_steps: 5,
              max_tokens: 4000,
              max_tool_calls: 3,
            };
          }

          if (agentData.status !== "active") {
            throw new AgentError({
              code: AgentErrorCodes.AGENT_NOT_ACTIVE,
              message: `El agente '${agentData.id}' no está activo (${agentData.status}).`,
              statusCode: 400,
            });
          }

          const policy = this.policyEngine.getDefaultPolicy(agentData.id, this.workspaceId);
          if (policy && policy.allow_execution === false) {
            throw new AgentError({
              code: AgentErrorCodes.AGENT_EXECUTION_BLOCKED,
              message: "La política de seguridad prohíbe la ejecución del agente.",
              statusCode: 403,
            });
          }

          const agent: Agent = {
            ...agentData,
            tools: agentData.agent_tools?.filter((t: any) => t.enabled).map((t: any) => t.tool_id) || [],
          };

          // =========================================================================
          // AGENT RUN INTEGRATION & RECOVERY DETERMINISTA (E4)
          // =========================================================================
          let existingAgentRun: any = null;
          if (this.supabaseClient) {
            const { data: runRec } = await (this.supabaseClient.from("agent_runs") as any)
              .select("*")
              .eq("job_run_id", jobRun.id)
              .maybeSingle();

            existingAgentRun = runRec;
          }

          let execResult: any;

          // Si ya existe un AgentRun terminal, no duplicar ni re-ejecutar (E4 & E5)
          if (existingAgentRun && ["completed", "failed", "cancelled"].includes(existingAgentRun.status)) {
            await this.completeJobRun(jobRun.id, lease.id, fencingToken, existingAgentRun.output);
            await traceSpan.end({ status: "completed", attributes: { outcome: "already_completed" } });
            return {
              success: true,
              status: "completed",
              runId: jobRun.id,
              fencingToken,
              output: existingAgentRun.output,
            };
          }

          // Detección de Cancelación Inter-Step antes de ejecutar o reanudar
          if (jobRun.status === "cancellation_requested" || jobAbortController.signal.aborted) {
            await this.handleCancellation(jobRun, lease, fencingToken);
            return {
              success: false,
              status: "cancelled",
              runId: jobRun.id,
              fencingToken,
              error: "JobRun cancelado durante la ejecución",
            };
          }

          if (existingAgentRun) {
            // Reanudar AgentRun existente bajo nuevo fencing token (Fase 4.9.1-R2)
            execResult = await this.agentRuntime.resumeInterruptedRun(
              existingAgentRun.id,
              this.supabaseClient,
              jobAbortController.signal,
              {
                fencingToken,
                workerId: this.workerIdentity,
              }
            );
          } else {
            // Ejecución inicial: vinculación idempotente de JobRun
            execResult = await this.agentRuntime.executeRun(
              agent,
              {
                agent_id: agent.id,
                workspace_id: this.workspaceId,
                user_id: agentData.created_by || "system-worker",
                input: jobRun.input || "",
                job_run_id: jobRun.id,
                fencing_token: fencingToken,
                worker_id: this.workerIdentity,
              },
              this.supabaseClient,
              jobAbortController.signal
            );
          }

          // =========================================================================
          // EVALUACIÓN DE RESULTADOS & GOBERNANZA HITL (E8)
          // =========================================================================
          if (execResult.needsApproval) {
            // Suspensión HITL: Desacopla worker y libera lease
            await this.jobQueue.releaseForApproval(
              jobRun.id,
              this.workerIdentity,
              fencingToken,
              this.supabaseClient
            );
            await this.registry.releaseLease(lease.id, this.workerId || "", fencingToken);

            await traceSpan.end({
              status: "completed",
              attributes: { outcome: "waiting_approval" },
            });

            return {
              success: true,
              status: "waiting_approval",
              runId: jobRun.id,
              fencingToken,
              output: execResult.run?.output || "Suspendido en espera de aprobación humana (HITL).",
            };
          }

          // Completado exitoso de JobRun (E3)
          await this.completeJobRun(
            jobRun.id,
            lease.id,
            fencingToken,
            execResult.run?.output || null,
            execResult.run?.tokens_input || 0,
            execResult.run?.tokens_output || 0
          );

          await traceSpan.end({
            status: "completed",
            attributes: {
              outcome: "completed",
              tokens_input: execResult.run?.tokens_input || 0,
              tokens_output: execResult.run?.tokens_output || 0,
            },
          });

          return {
            success: true,
            status: "completed",
            runId: jobRun.id,
            fencingToken,
            output: execResult.run?.output,
          };
        } catch (err: any) {
          return await this.handleExecutionError(err, jobRun, lease, fencingToken, traceSpan);
        } finally {
          this.activeJobs.delete(jobRun.id);
          // Si está drenando y no quedan jobs activos, transicionar a STOPPED
          if (this.status === "DRAINING" && this.activeJobs.size === 0) {
            this.status = "STOPPED";
          }
        }
      }
    );
  }

  /**
   * Pasa el worker a estado DRAINING, impidiendo nuevos reclamos y esperando a que los activos finalicen.
   */
  public async drain(reason: string = "Mantenimiento programado"): Promise<DrainWorkerResult> {
    this.status = "DRAINING";
    if (this.workerId) {
      await this.registry.drain(this.workerId, "system", reason);
    }
    if (this.activeJobs.size === 0) {
      this.status = "STOPPED";
    }
    return {
      success: true,
      status: this.status,
      active_leases: this.activeJobs.size,
    };
  }

  /**
   * Parada inmediata y ordenada (Graceful Shutdown) del Worker.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    this.status = "STOPPED";

    // Detener bucle de heartbeat
    if (this.heartbeatAbortController) {
      this.heartbeatAbortController.abort();
      this.heartbeatAbortController = null;
    }

    // Abortar jobs activos de forma controlada
    for (const [jobRunId, ctx] of Array.from(this.activeJobs.entries())) {
      try {
        ctx.abortController.abort();
        if (this.workerId) {
          await this.registry.releaseLease(ctx.lease.id, this.workerId, ctx.fencingToken);
        }
      } catch {
        // Safe cleanup
      }
    }
    this.activeJobs.clear();
  }

  /**
   * Trata un error durante la ejecución clasificándolo entre reintentable y no reintentable.
   */
  private async handleExecutionError(
    err: any,
    jobRun: any,
    lease: WorkerLease,
    fencingToken: bigint | number,
    traceSpan: any
  ): Promise<JobExecutionResult> {
    const cpError = ControlPlaneError.classify(err);
    const errorCode = err?.code || cpError.code;
    const errorMessage = err?.message || cpError.message;

    // Errores estrictamente NO reintentables
    const nonRetryableCodes = [
      "AUTHORIZATION",
      "FENCING",
      "QUARANTINE",
      AgentErrorCodes.AGENT_PERMISSION_DENIED,
      AgentErrorCodes.AGENT_EXECUTION_BLOCKED,
      AgentErrorCodes.TOOL_NOT_ALLOWED,
      AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
      AgentErrorCodes.TOOL_FENCING_REJECTED,
      AgentErrorCodes.TOOL_SCHEMA_INVALID,
      "AUTHORIZATION_REVOKED",
    ];

    const isRetryable = cpError.isRetryable && !nonRetryableCodes.includes(errorCode as any);

    try {
      if (this.supabaseClient) {
        await this.jobQueue.failAndRetry(
          jobRun.id,
          this.workerIdentity,
          fencingToken,
          errorCode,
          errorMessage,
          isRetryable,
          this.supabaseClient
        );
      }
      if (this.workerId) {
        await this.registry.releaseLease(lease.id, this.workerId, fencingToken);
      }
    } catch {
      // Ignorar errores colaterales de liberación
    }

    await traceSpan.end({
      status: "failed",
      error: err,
      attributes: { is_retryable: isRetryable, error_code: errorCode },
    });

    return {
      success: false,
      status: isRetryable ? "retry_scheduled" : "failed",
      runId: jobRun.id,
      fencingToken,
      error: errorMessage,
      errorCode,
      isRetryable,
    };
  }

  /**
   * Sella un JobRun completado y libera el lease.
   */
  private async completeJobRun(
    jobRunId: string,
    leaseId: string,
    fencingToken: bigint | number,
    output?: any,
    tokensInput: number = 0,
    tokensOutput: number = 0
  ): Promise<void> {
    if (this.supabaseClient) {
      await this.jobQueue.complete(
        jobRunId,
        this.workerIdentity,
        fencingToken,
        typeof output === "string" ? output : JSON.stringify(output),
        tokensInput,
        tokensOutput,
        this.supabaseClient
      );
    }
    if (this.workerId) {
      await this.registry.releaseLease(leaseId, this.workerId, fencingToken);
    }
  }

  /**
   * Trata la cancelación segura de un JobRun.
   */
  private async handleCancellation(
    jobRun: any,
    lease: WorkerLease,
    fencingToken: bigint | number
  ): Promise<void> {
    if (this.supabaseClient) {
      await (this.supabaseClient.from("job_runs") as any)
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Ejecución cancelada a petición del usuario o Control Plane.",
        })
        .eq("id", jobRun.id)
        .eq("workspace_id", this.workspaceId);
    }
    if (this.workerId) {
      await this.registry.releaseLease(lease.id, this.workerId, fencingToken);
    }
  }

  /**
   * Bucle secuencial y seguro de heartbeats del worker.
   */
  private startHeartbeatLoop(): void {
    if (this.heartbeatAbortController) {
      this.heartbeatAbortController.abort();
    }
    this.heartbeatAbortController = new AbortController();
    const signal = this.heartbeatAbortController.signal;

    const loop = async () => {
      while (this.isRunning && !signal.aborted && (this.status === "HEALTHY" || this.status === "DRAINING")) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.heartbeatIntervalMs);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });

        if (!this.isRunning || signal.aborted || !this.workerId) break;

        try {
          const hbRes = await this.registry.heartbeat(this.workerId, this.instanceIdentity);
          if (hbRes.success && hbRes.status) {
            // Sincronizar estado si el Control Plane lo cambió externamente (ej. QUARANTINED o STALE)
            if (hbRes.status !== this.status && this.status !== "DRAINING") {
              this.status = hbRes.status;
            }
          } else if (hbRes.error_code === "WORKER_QUARANTINED") {
            this.status = "QUARANTINED";
            break;
          }
        } catch {
          // Anomalía de latido: no tumbar el proceso inmediatamente
        }
      }
    };

    loop().catch(() => {});
  }
}
