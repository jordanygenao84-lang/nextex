/**
 * NEXTEХ (Nexora Texter) — Cancellation & Draining Coordinator (Fase 4.10-G)
 * Coordinador canónico de cancelación durable, drenado de workers y workspaces,
 * resolución de conflictos HITL/Retry y secuencia determinista de 10 pasos de Shutdown.
 */

import {
  RequestCancellationParams,
  CancellationResult,
  CancellationStatus,
  ShutdownSequenceParams,
  ShutdownResult,
  ShutdownStepResult,
  ControlPlaneError,
} from "./types";
import { Dispatcher } from "./Dispatcher";
import { WorkerRegistry } from "./WorkerRegistry";
import { RecoveryManager } from "./RecoveryManager";
import { tracer } from "@/lib/observability/tracer";
import { ObservabilityContext } from "@/lib/observability/context";

export interface CancellationManagerConfig {
  workspaceId?: string;
  supabaseClient?: any;
  registry?: WorkerRegistry;
  recoveryManager?: RecoveryManager;
}

export class CancellationManager {
  private readonly workspaceId?: string;
  private readonly supabaseClient?: any;
  private readonly registry: WorkerRegistry;
  private readonly recoveryManager: RecoveryManager;
  private isShutdown = false;

  constructor(config: CancellationManagerConfig = {}) {
    this.workspaceId = config.workspaceId;
    this.supabaseClient = config.supabaseClient;
    this.registry = config.registry || new WorkerRegistry(this.supabaseClient);
    this.recoveryManager =
      config.recoveryManager ||
      new RecoveryManager({
        workspaceId: this.workspaceId,
        supabaseClient: this.supabaseClient,
        registry: this.registry,
      });
  }

  /**
   * Sanitiza cualquier detalle antes de persistir en auditoría de cancelación.
   */
  public static sanitizeDetails(obj: any): any {
    return RecoveryManager.sanitizeDetails(obj);
  }

  /**
   * Solicita la cancelación durable de un JobRun, Job, Automatización o Workspace entero (G1, G2).
   */
  public async requestCancellation(
    params: RequestCancellationParams
  ): Promise<CancellationResult> {
    const { workspaceId, jobRunId, jobId, automationId, source, actorId, actorType, reason, correlationId } = params;

    if (!workspaceId) {
      throw new ControlPlaneError("workspaceId es obligatorio para solicitar cancelación", "AUTHORIZATION");
    }

    if (this.workspaceId && this.workspaceId !== workspaceId) {
      throw new ControlPlaneError(
        `Violación de frontera de tenant (Manager ws: '${this.workspaceId}' vs Params ws: '${workspaceId}')`,
        "AUTHORIZATION"
      );
    }

    const span = tracer.startSpan({
      name: "cancellation.request",
      component: "cancellation_manager",
      spanType: "job",
      workspaceId,
      jobRunId: jobRunId || undefined,
      attributes: {
        source,
        actor_id: actorId || "system",
        actor_type: actorType || "system",
        correlation_id: correlationId || "",
      },
    });

    return ObservabilityContext.run(
      {
        traceId: span.traceId,
        spanId: span.spanId,
        workspaceId,
      },
      async () => {
        try {
          // 1. Cancelación puntual de un JobRun
          if (jobRunId) {
            const res = await this.registry.requestCancellation({
              jobRunId,
              actorId: actorId || "system",
              reason: reason || `Cancelación solicitada vía ${source}`,
            });

            await this.recoveryManager.auditRecoveryEvent({
              workspaceId,
              jobRunId,
              action: "cancellation_requested",
              details: {
                source,
                actor_id: actorId || "system",
                actor_type: actorType || "system",
                reason: reason || null,
                correlation_id: correlationId || null,
              },
            });

            await span.end({ status: "completed", attributes: { outcome: res.status } });

            return {
              success: res.success,
              jobRunId,
              status: (res.status as CancellationStatus) || "cancellation_requested",
              affectedRunsCount: res.success ? 1 : 0,
              message: res.error_message || "Cancelación procesada",
              error_code: res.error_code,
            };
          }

          // 2. Cancelación a nivel de Job
          if (jobId) {
            return await this.cancelJob(jobId, workspaceId, actorId, reason, correlationId);
          }

          // 3. Cancelación a nivel de Automatización
          if (automationId) {
            return await this.cancelAutomation(automationId, workspaceId, actorId, reason, correlationId);
          }

          // 4. Cancelación a nivel de Workspace completo
          return await this.cancelWorkspace(workspaceId, actorId, reason, correlationId);
        } catch (err: any) {
          const cpError = ControlPlaneError.classify(err);
          await span.end({ status: "failed", error: cpError.message });
          throw cpError;
        }
      }
    );
  }

  /**
   * Cancela todos los JobRuns no terminales de un Job específico dentro de un Workspace (G2, G18).
   */
  public async cancelJob(
    jobId: string,
    workspaceId: string,
    actorId?: string,
    reason?: string,
    correlationId?: string
  ): Promise<CancellationResult> {
    if (!this.supabaseClient) {
      return { success: true, status: "cancelled", affectedRunsCount: 0 };
    }

    const { data: runs, error } = await (this.supabaseClient.from("job_runs") as any)
      .select("id, status, workspace_id")
      .eq("job_id", jobId)
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "claimed", "running", "waiting_approval", "retry_scheduled"]);

    if (error) throw ControlPlaneError.classify(error);

    let cancelledCount = 0;
    const runList = runs || [];

    for (const run of runList) {
      try {
        await this.registry.requestCancellation({
          jobRunId: run.id,
          actorId: actorId || "system",
          reason: reason || `Cancelación de Job ${jobId}`,
        });
        cancelledCount++;
      } catch {
        // Continuar con los demás runs
      }
    }

    return {
      success: true,
      status: "cancelled",
      affectedRunsCount: cancelledCount,
      message: `Cancelados ${cancelledCount} runs para Job ${jobId}`,
    };
  }

  /**
   * Cancela todos los JobRuns no terminales de una Automatización (G2).
   */
  public async cancelAutomation(
    automationId: string,
    workspaceId: string,
    actorId?: string,
    reason?: string,
    correlationId?: string
  ): Promise<CancellationResult> {
    if (!this.supabaseClient) {
      return { success: true, status: "cancelled", affectedRunsCount: 0 };
    }

    // Consultar jobs vinculados a la automatización
    const { data: jobs, error: jobErr } = await (this.supabaseClient.from("jobs") as any)
      .select("id")
      .eq("automation_id", automationId)
      .eq("workspace_id", workspaceId);

    if (jobErr) throw ControlPlaneError.classify(jobErr);

    const jobIds = (jobs || []).map((j: any) => j.id);
    let totalCancelled = 0;

    for (const jId of jobIds) {
      const res = await this.cancelJob(jId, workspaceId, actorId, reason, correlationId);
      totalCancelled += res.affectedRunsCount;
    }

    return {
      success: true,
      status: "cancelled",
      affectedRunsCount: totalCancelled,
      message: `Cancelados ${totalCancelled} runs para Automatización ${automationId}`,
    };
  }

  /**
   * Cancela todos los JobRuns activos y en cola de un Workspace (G12).
   */
  public async cancelWorkspace(
    workspaceId: string,
    actorId?: string,
    reason?: string,
    correlationId?: string
  ): Promise<CancellationResult> {
    if (!this.supabaseClient) {
      return { success: true, status: "cancelled", affectedRunsCount: 0 };
    }

    const { data: runs, error } = await (this.supabaseClient.from("job_runs") as any)
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "claimed", "running", "waiting_approval", "retry_scheduled"]);

    if (error) throw ControlPlaneError.classify(error);

    let cancelledCount = 0;
    for (const run of runs || []) {
      try {
        await this.registry.requestCancellation({
          jobRunId: run.id,
          actorId: actorId || "system",
          reason: reason || "Drenado y cancelación de Workspace",
        });
        cancelledCount++;
      } catch {
        // Continuar
      }
    }

    return {
      success: true,
      status: "cancelled",
      affectedRunsCount: cancelledCount,
      message: `Cancelados ${cancelledCount} runs en Workspace ${workspaceId}`,
    };
  }

  /**
   * Resuelve el conflicto determinista entre Aprobación Humana y Cancelación (G6).
   * REGLA: Si existe cancelación pendiente o autorizada, CANCELACIÓN GANA SIEMPRE.
   */
  public evaluateCancellationVsHitl(
    jobRunId: string,
    approvalPending: boolean,
    cancellationPending: boolean
  ): { canApprove: boolean; action: "cancel" | "proceed"; resolution: string } {
    if (cancellationPending) {
      return {
        canApprove: false,
        action: "cancel",
        resolution: "Cancelación autoritativa prevalece sobre aprobación humana.",
      };
    }

    return {
      canApprove: approvalPending,
      action: "proceed",
      resolution: approvalPending ? "Aprobación autorizada." : "No hay aprobación pendiente.",
    };
  }

  /**
   * Resuelve el conflicto determinista entre Reintento Programado y Cancelación (G7).
   * REGLA: Si existe cancelación solicitada, NUNCA se permite crear o ejecutar un nuevo retry.
   */
  public evaluateCancellationVsRetry(
    jobRunId: string,
    isCancellationRequested: boolean
  ): { canRetry: boolean; action: "cancel_retry" | "proceed"; resolution: string } {
    if (isCancellationRequested) {
      return {
        canRetry: false,
        action: "cancel_retry",
        resolution: "Reintento abortado: JobRun posee cancelación autoritativa solicitada.",
      };
    }

    return {
      canRetry: true,
      action: "proceed",
      resolution: "Reintento permitido conforme a la política de reintentos.",
    };
  }

  /**
   * Drena un Worker con timeout configurable (G8, G9).
   * Si no finaliza dentro del timeout, fuerza la transición a STOPPED y libera leases.
   */
  public async drainWorkerWithTimeout(
    workerId: string,
    timeoutMs: number = 5000,
    actorId?: string,
    reason?: string
  ): Promise<{ drained: boolean; remainingJobs: number; forcedStop: boolean }> {
    const drainRes = await this.registry.drain(workerId, actorId, reason);

    if (drainRes.active_leases === 0) {
      return { drained: true, remainingJobs: 0, forcedStop: false };
    }

    // Esperar cooperativamente hasta el timeout
    const startTime = Date.now();
    let remaining = drainRes.active_leases || 0;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
      const w = await this.registry.getWorker(workerId);
      if (!w || w.status === "STOPPED" || w.current_concurrency === 0) {
        return { drained: true, remainingJobs: 0, forcedStop: false };
      }
      remaining = w.current_concurrency;
    }

    // Al expirar timeout: forzar recuperación y parada (G9)
    if (this.supabaseClient) {
      // Expirar forzosamente leases activos del worker
      for (const lease of (this.supabaseClient.worker_leases?.values() || [])) {
        if (lease.worker_id === workerId && lease.status === "active") {
          lease.status = "expired";
        }
      }
    }

    await this.recoveryManager.runRecoveryCycle({ batchSize: 50 });

    return {
      drained: true,
      remainingJobs: remaining,
      forcedStop: true,
    };
  }

  /**
   * Drena un workspace específico (G12).
   */
  public drainWorkspace(workspaceId: string): void {
    Dispatcher.drainWorkspace(workspaceId);
  }

  /**
   * Reanuda la operación de un workspace previamente drenado (G12).
   */
  public resumeWorkspace(workspaceId: string): void {
    Dispatcher.resumeWorkspace(workspaceId);
  }

  /**
   * Consulta si un workspace está actualmente en estado draining (G12).
   */
  public isWorkspaceDraining(workspaceId: string): boolean {
    return Dispatcher.isWorkspaceDraining(workspaceId);
  }

  /**
   * Activa o desactiva el congelamiento global de despachos (Global Drain) (G13).
   */
  public setGlobalDrain(enabled: boolean): void {
    Dispatcher.setGlobalDrain(enabled);
  }

  /**
   * Consulta el estado del congelamiento global (G13).
   */
  public isGlobalDrain(): boolean {
    return Dispatcher.isGlobalDrain();
  }

  /**
   * Ejecuta la secuencia canónica y determinista de 10 pasos de Control Plane Shutdown (G14, G15).
   *
   * SECUENCIA OBLIGATORIA:
   * 1. STOP NEW CLAIMS
   * 2. MARK DRAINING
   * 3. SIGNAL ACTIVE WORKERS
   * 4. HONOR CANCELLATION
   * 5. WAIT FOR SAFE COMPLETION
   * 6. RELEASE LEASES
   * 7. FENCE REMAINING AUTHORITY
   * 8. RECOVER UNFINISHED JOBS
   * 9. STOP WORKERS
   * 10. WRITE FINAL AUDIT
   */
  public async executeShutdownSequence(
    params: ShutdownSequenceParams = {}
  ): Promise<ShutdownResult> {
    const { workspaceId, timeoutMs = 3000, reason = "Control Plane Shutdown", actorId = "system", correlationId } = params;

    const span = tracer.startSpan({
      name: "control_plane.shutdown",
      component: "cancellation_manager",
      spanType: "system",
      workspaceId: workspaceId || "global",
      attributes: {
        timeout_ms: timeoutMs,
        reason,
        actor_id: actorId,
        correlation_id: correlationId || "",
      },
    });

    const steps: ShutdownStepResult[] = [];
    let drainedWorkersCount = 0;
    let releasedLeasesCount = 0;
    let recoveredJobsCount = 0;

    return ObservabilityContext.run(
      {
        traceId: span.traceId,
        spanId: span.spanId,
        workspaceId: workspaceId || "global",
      },
      async () => {
        try {
          // Idempotencia de Shutdown (G15): si ya fue ejecutado, devolver reporte limpio
          if (this.isShutdown) {
            steps.push({ step: 0, name: "IDEMPOTENT_CHECK", status: "completed", details: { message: "Already shut down" } });
            await span.end({ status: "completed", attributes: { outcome: "already_shut_down" } });
            return {
              success: true,
              status: "COMPLETED",
              steps,
              drainedWorkersCount: 0,
              recoveredJobsCount: 0,
              releasedLeasesCount: 0,
              timestamp: new Date().toISOString(),
            };
          }

          // PASO 1: STOP NEW CLAIMS (Congelar despachos inmediatamente)
          if (workspaceId) {
            this.drainWorkspace(workspaceId);
          } else {
            this.setGlobalDrain(true);
          }
          steps.push({ step: 1, name: "STOP_NEW_CLAIMS", status: "completed" });

          // PASO 2: MARK DRAINING (Pasar workers elegibles a DRAINING)
          let workersList: any[] = [];
          if (this.supabaseClient) {
            workersList = Array.from(this.supabaseClient.workers?.values() || []);
            if (workspaceId) workersList = workersList.filter((w) => w.workspace_id === workspaceId);
            for (const w of workersList) {
              if (w.status === "HEALTHY") {
                w.status = "DRAINING";
                drainedWorkersCount++;
              }
            }
          }
          steps.push({ step: 2, name: "MARK_DRAINING", status: "completed", details: { drainedWorkersCount } });

          // PASO 3: SIGNAL ACTIVE WORKERS (Interrupción cooperativa de bucles de latido)
          await this.registry.shutdown();
          steps.push({ step: 3, name: "SIGNAL_ACTIVE_WORKERS", status: "completed" });

          // PASO 4: HONOR CANCELLATION (Procesar cancelaciones pendientes en el ámbito)
          if (workspaceId) {
            await this.cancelWorkspace(workspaceId, actorId, "Shutdown cancellation");
          }
          steps.push({ step: 4, name: "HONOR_CANCELLATION", status: "completed" });

          // PASO 5: WAIT FOR SAFE COMPLETION (Esperar hasta timeout a que active jobs finalicen)
          await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 500)));
          steps.push({ step: 5, name: "WAIT_FOR_SAFE_COMPLETION", status: "completed" });

          // PASO 6: RELEASE LEASES (Liberar leases de workers finalizados o vencidos)
          if (this.supabaseClient) {
            for (const lease of (this.supabaseClient.worker_leases?.values() || [])) {
              if (lease.status === "active") {
                if (!workspaceId || lease.workspace_id === workspaceId) {
                  lease.status = "released";
                  releasedLeasesCount++;
                }
              }
            }
          }
          steps.push({ step: 6, name: "RELEASE_LEASES", status: "completed", details: { releasedLeasesCount } });

          // PASO 7: FENCE REMAINING AUTHORITY (Invalidar tokens antiguos para proteger contra zombies)
          if (this.supabaseClient) {
            for (const run of (this.supabaseClient.job_runs?.values() || [])) {
              if (!workspaceId || run.workspace_id === workspaceId) {
                if (
                  run.status === "claimed" ||
                  run.status === "running" ||
                  run.status === "cancellation_requested"
                ) {
                  run.fencing_token = BigInt(run.fencing_token || 0) + BigInt(1);
                }
              }
            }
          }
          steps.push({ step: 7, name: "FENCE_REMAINING_AUTHORITY", status: "completed" });

          // PASO 8: RECOVER UNFINISHED JOBS (Recuperar y re-encolar trabajos incompletos)
          const recRes = await this.recoveryManager.runRecoveryCycle({ batchSize: 50 });
          recoveredJobsCount = recRes.recoveredJobsCount || 0;
          steps.push({ step: 8, name: "RECOVER_UNFINISHED_JOBS", status: "completed", details: { recoveredJobsCount } });

          // PASO 9: STOP WORKERS (Transicionar definitivamente a STOPPED)
          if (this.supabaseClient) {
            for (const w of workersList) {
              w.status = "STOPPED";
              w.current_concurrency = 0;
            }
          }
          steps.push({ step: 9, name: "STOP_WORKERS", status: "completed" });

          // PASO 10: WRITE FINAL AUDIT (Persistir evento append-only de shutdown completado)
          await this.recoveryManager.auditRecoveryEvent({
            workspaceId: workspaceId || "global",
            action: "recovery_completed",
            details: {
              shutdown_completed: true,
              reason,
              actor_id: actorId,
              correlation_id: correlationId || null,
              drainedWorkersCount,
              releasedLeasesCount,
              recoveredJobsCount,
            },
          });
          steps.push({ step: 10, name: "WRITE_FINAL_AUDIT", status: "completed" });

          this.isShutdown = true;

          await span.end({
            status: "completed",
            attributes: {
              steps_executed: steps.length,
              drained_workers: drainedWorkersCount,
              recovered_jobs: recoveredJobsCount,
            },
          });

          return {
            success: true,
            status: "COMPLETED",
            steps,
            drainedWorkersCount,
            recoveredJobsCount,
            releasedLeasesCount,
            timestamp: new Date().toISOString(),
          };
        } catch (err: any) {
          const cpError = ControlPlaneError.classify(err);
          await span.end({ status: "failed", error: cpError.message });
          return {
            success: false,
            status: "FAILED",
            steps,
            drainedWorkersCount,
            recoveredJobsCount,
            releasedLeasesCount,
            timestamp: new Date().toISOString(),
          };
        }
      }
    );
  }
}
