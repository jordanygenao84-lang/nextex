/**
 * NEXTEХ (Nexora Texter) — Recovery & Fault Tolerance Manager (Fase 4.10-F)
 * Subsistema canónico de recuperación ante fallos de workers, leases vencidos,
 * detección de workers zombies, ordenamiento estricto de barreras y reconciliación determinista.
 */

import {
  Worker,
  WorkerLease,
  ControlPlaneError,
  RecoveryAuditEntry,
  RecoveryCycleResult,
  ValidateRecoveryOrderingParams,
  ValidateRecoveryOrderingResult,
  RecoveryManagerConfig,
} from "./types";
import { WorkerRegistry } from "./WorkerRegistry";
import { tracer } from "@/lib/observability/tracer";
import { ObservabilityContext } from "@/lib/observability/context";

export class RecoveryManager {
  private readonly workspaceId?: string;
  private readonly supabaseClient?: any;
  private readonly registry: WorkerRegistry;
  private readonly staleThresholdSeconds: number;

  constructor(config: RecoveryManagerConfig = {}) {
    this.workspaceId = config.workspaceId;
    this.supabaseClient = config.supabaseClient;
    this.registry = config.registry || new WorkerRegistry(this.supabaseClient);
    this.staleThresholdSeconds = config.staleThresholdSeconds ?? 90;
  }

  /**
   * Sanitiza cualquier secreto o token confidencial de un objeto antes de persistir en auditoría.
   */
  public static sanitizeDetails(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => RecoveryManager.sanitizeDetails(item));

    const sanitized: Record<string, any> = {};
    const exactSensitiveKeys = new Set([
      "api_key",
      "apikey",
      "secret",
      "password",
      "token",
      "authorization",
      "cookie",
      "service_role",
      "auth_header",
      "private_key",
      "secret_key",
      "access_key",
      "client_secret",
      "api_secret",
      "signing_key",
    ]);

    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      const isSensitive =
        exactSensitiveKeys.has(lower) ||
        lower.startsWith("api_key") ||
        lower.startsWith("apikey") ||
        lower.endsWith("_secret") ||
        lower.endsWith("_token") ||
        lower.endsWith("_password");

      if (isSensitive) {
        sanitized[k] = "[REDACTED]";
      } else if (v && typeof v === "object") {
        sanitized[k] = RecoveryManager.sanitizeDetails(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /**
   * Registra un evento de recovery de forma append-only en la auditoría inmutable del Control Plane.
   */
  public async auditRecoveryEvent(entry: RecoveryAuditEntry): Promise<void> {
    const sanitizedDetails = RecoveryManager.sanitizeDetails(entry.details || {});
    const timestamp = entry.timestamp || new Date().toISOString();

    if (this.supabaseClient) {
      // 1. Auditoría a nivel de JobRun si existe identificador de job
      if (entry.jobRunId) {
        try {
          await (this.supabaseClient.from("job_audit_log") as any).insert({
            workspace_id: entry.workspaceId,
            job_run_id: entry.jobRunId,
            actor_type: "system",
            actor_id: entry.workerId || "recovery_manager",
            action: entry.action,
            previous_status: entry.previousStatus || null,
            new_status: entry.newStatus || null,
            fencing_token: entry.fencingToken ? Number(entry.fencingToken) : null,
            details: sanitizedDetails,
            created_at: timestamp,
          });
        } catch {
          // Fallback silencioso en auditoría para no bloquear la operación
        }
      }

      // 2. Auditoría a nivel de Worker si existe identificador de worker
      if (entry.workerId) {
        try {
          await (this.supabaseClient.from("worker_audit_log") as any).insert({
            workspace_id: entry.workspaceId,
            worker_id: entry.workerId,
            actor_type: "system",
            actor_id: "recovery_manager",
            action: entry.action.toUpperCase(),
            previous_status: entry.previousStatus || null,
            new_status: entry.newStatus || null,
            details: sanitizedDetails,
            created_at: timestamp,
          });
        } catch {
          // Fallback silencioso en auditoría
        }
      }
    }
  }

  /**
   * Valida rigurosamente el orden de barreras antes de cualquier mutación o efecto secundario (F19).
   * Orden canónico:
   * 1. tenant_authorization
   * 2. worker_authority
   * 3. lease_authority
   * 4. fencing_authority
   * 5. job_state
   * 6. agent_authority
   * 7. step_lineage
   */
  public verifyRecoveryOrdering(
    params: ValidateRecoveryOrderingParams
  ): ValidateRecoveryOrderingResult {
    const { workspaceId, worker, lease, fencingToken, jobRun, agent, policy, steps } = params;

    // 1. Tenant Authorization Barrier
    if (
      workspaceId !== worker.workspace_id ||
      workspaceId !== lease.workspace_id ||
      workspaceId !== jobRun.workspace_id
    ) {
      return {
        valid: false,
        barrierFailed: "tenant_authorization",
        error: new ControlPlaneError(
          `Violación de frontera de tenant (Esperado ws: '${workspaceId}', Worker ws: '${worker.workspace_id}', Job ws: '${jobRun.workspace_id}')`,
          "AUTHORIZATION"
        ),
      };
    }

    // 2. Worker Authority Barrier
    if (worker.status !== "HEALTHY") {
      return {
        valid: false,
        barrierFailed: "worker_authority",
        error: new ControlPlaneError(
          `Worker '${worker.worker_identity}' carece de autoridad operativa (${worker.status})`,
          worker.status === "QUARANTINED" ? "QUARANTINE" : "PERMANENT"
        ),
      };
    }

    // 3. Lease Authority Barrier
    const isLeaseActive = lease.status === "active";
    const isLeaseExpired =
      lease.expires_at && new Date(lease.expires_at).getTime() <= Date.now();
    if (!isLeaseActive || isLeaseExpired) {
      return {
        valid: false,
        barrierFailed: "lease_authority",
        error: new ControlPlaneError(
          `Lease '${lease.id}' inactivo o vencido para el JobRun '${jobRun.id}'`,
          "FENCING"
        ),
      };
    }

    // 4. Fencing Authority Barrier (Monotonía y coherencia)
    if (fencingToken === undefined || fencingToken === null) {
      return {
        valid: false,
        barrierFailed: "fencing_authority",
        error: new ControlPlaneError("Fencing token ausente en la solicitud", "FENCING"),
      };
    }

    const tokenVal = BigInt(fencingToken);
    if (lease.fencing_token !== undefined && lease.fencing_token !== null) {
      if (tokenVal < BigInt(lease.fencing_token)) {
        return {
          valid: false,
          barrierFailed: "fencing_authority",
          error: new ControlPlaneError(
            `Fencing token desfasado (${fencingToken} < lease: ${lease.fencing_token})`,
            "FENCING"
          ),
        };
      }
    }

    if (jobRun.fencing_token !== undefined && jobRun.fencing_token !== null) {
      if (tokenVal < BigInt(jobRun.fencing_token)) {
        return {
          valid: false,
          barrierFailed: "fencing_authority",
          error: new ControlPlaneError(
            `Fencing token desfasado (${fencingToken} < jobRun: ${jobRun.fencing_token})`,
            "FENCING"
          ),
        };
      }
    }

    // 5. JobRun State Barrier
    if (["cancelled", "cancellation_requested", "dead_letter", "completed"].includes(jobRun.status)) {
      return {
        valid: false,
        barrierFailed: "job_state",
        error: new ControlPlaneError(
          `JobRun '${jobRun.id}' en estado incompatible para reanudación (${jobRun.status})`,
          "CANCELLATION"
        ),
      };
    }

    // 6. Agent Authority Barrier
    if (agent) {
      if (agent.status !== "active") {
        return {
          valid: false,
          barrierFailed: "agent_authority",
          error: new ControlPlaneError(
            `El agente '${agent.id}' no está activo (${agent.status})`,
            "AUTHORIZATION"
          ),
        };
      }
      if (policy && policy.allow_execution === false) {
        return {
          valid: false,
          barrierFailed: "agent_authority",
          error: new ControlPlaneError(
            `La política de gobernanza prohíbe la ejecución del agente '${agent.id}'`,
            "AUTHORIZATION"
          ),
        };
      }
    }

    // 7. Step Lineage Barrier
    if (steps && steps.length > 0) {
      let lastStepNum = 0;
      for (const step of steps) {
        if (step.step_number <= lastStepNum) {
          return {
            valid: false,
            barrierFailed: "step_lineage",
            error: new ControlPlaneError(
              `Secuencia de pasos no monótona detectada (paso ${step.step_number} <= ${lastStepNum})`,
              "PERMANENT"
            ),
          };
        }
        lastStepNum = step.step_number;
      }
    }

    return { valid: true };
  }

  /**
   * Ejecuta un ciclo de recuperación integral:
   * 1. Detecta workers inactivos y los marca STALE.
   * 2. Recupera leases vencidos mediante RPC transaccional del Control Plane.
   * 3. Registra eventos de auditoría y correlación de observabilidad.
   */
  public async runRecoveryCycle(options: {
    batchSize?: number;
    staleTimeoutSeconds?: number;
  } = {}): Promise<RecoveryCycleResult> {
    const batchSize = options.batchSize ?? 20;
    const staleTimeout = options.staleTimeoutSeconds ?? this.staleThresholdSeconds;

    const span = tracer.startSpan({
      name: "recovery.cycle",
      component: "recovery_manager",
      spanType: "system",
      workspaceId: this.workspaceId || "global",
      attributes: {
        batch_size: batchSize,
        stale_timeout_seconds: staleTimeout,
      },
    });

    return ObservabilityContext.run(
      {
        traceId: span.traceId,
        spanId: span.spanId,
        workspaceId: this.workspaceId || "global",
      },
      async () => {
        try {
          // 1. Marcar workers sin latido como STALE
          const staleWorkersCount = await this.registry.markStale(staleTimeout);
          if (staleWorkersCount > 0 && this.workspaceId) {
            await this.auditRecoveryEvent({
              workspaceId: this.workspaceId,
              action: "worker_stale",
              details: { stale_count: staleWorkersCount, timeout_seconds: staleTimeout },
            });
          }

          // 2. Recuperar jobs con leases vencidos
          const recResult = await this.registry.recoverJobs(batchSize);
          const recoveredJobsCount = recResult.recovered_count || 0;

          if (recoveredJobsCount > 0 && this.workspaceId) {
            await this.auditRecoveryEvent({
              workspaceId: this.workspaceId,
              action: "recovery_completed",
              details: { recovered_jobs: recoveredJobsCount },
            });
          }

          await span.end({
            status: "completed",
            attributes: {
              stale_workers: staleWorkersCount,
              recovered_jobs: recoveredJobsCount,
            },
          });

          return {
            success: true,
            recoveredJobsCount,
            staleWorkersCount,
            details: {
              stale_workers: staleWorkersCount,
              recovered_jobs: recoveredJobsCount,
            },
          };
        } catch (err: any) {
          const cpError = ControlPlaneError.classify(err);
          await span.end({
            status: "failed",
            error: cpError.message,
          });

          return {
            success: false,
            recoveredJobsCount: 0,
            staleWorkersCount: 0,
            error: cpError.message,
          };
        }
      }
    );
  }

  /**
   * Reconcilia un AgentRun existente vinculado al JobRun para evitar duplicación física de ejecuciones.
   */
  public async reconcileAgentRun(
    jobRunId: string
  ): Promise<{
    existingRun: any;
    resumable: boolean;
    nextStepNumber: number;
    completedSteps: any[];
  }> {
    if (!this.supabaseClient) {
      return { existingRun: null, resumable: false, nextStepNumber: 1, completedSteps: [] };
    }

    const { data: runRec } = await (this.supabaseClient.from("agent_runs") as any)
      .select("*")
      .eq("job_run_id", jobRunId)
      .maybeSingle();

    if (!runRec) {
      return { existingRun: null, resumable: false, nextStepNumber: 1, completedSteps: [] };
    }

    const isTerminal = ["completed", "failed", "cancelled"].includes(runRec.status);
    if (isTerminal) {
      return {
        existingRun: runRec,
        resumable: false,
        nextStepNumber: -1,
        completedSteps: [],
      };
    }

    // Consultar pasos completados existentes para reanudar sin duplicidad
    const { data: steps } = await (this.supabaseClient.from("agent_run_steps") as any)
      .select("*")
      .eq("run_id", runRec.id)
      .order("step_number", { ascending: true });

    const stepList = steps || [];
    const completedSteps = stepList.filter((s: any) => s.status === "completed");
    const maxCompletedStepNumber = completedSteps.reduce(
      (max: number, s: any) => Math.max(max, s.step_number || 0),
      0
    );

    return {
      existingRun: runRec,
      resumable: true,
      nextStepNumber: maxCompletedStepNumber + 1,
      completedSteps,
    };
  }

  /**
   * Detecta y bloquea activamente un intento de ejecución por parte de un Worker Zombie (F3).
   */
  public async assertZombieFencing(
    jobRunId: string,
    attemptedFencingToken: bigint | number
  ): Promise<void> {
    if (!this.supabaseClient) return;

    const { data: run } = await (this.supabaseClient.from("job_runs") as any)
      .select("fencing_token, status, workspace_id")
      .eq("id", jobRunId)
      .maybeSingle();

    if (run && run.fencing_token !== undefined) {
      const currentToken = BigInt(run.fencing_token);
      const attemptedToken = BigInt(attemptedFencingToken);

      if (currentToken > attemptedToken) {
        if (run.workspace_id) {
          await this.auditRecoveryEvent({
            workspaceId: run.workspace_id,
            jobRunId,
            action: "zombie_execution_rejected",
            fencingToken: attemptedToken,
            details: {
              attempted_token: Number(attemptedToken),
              current_token: Number(currentToken),
              reason: "Fencing token desfasado superado por recuperación autoritativa",
            },
          });
        }

        throw new ControlPlaneError(
          `FENCING_REJECTED: Fencing token ${attemptedToken} desfasado frente a versión autoritativa ${currentToken}`,
          "FENCING"
        );
      }
    }
  }

  /**
   * Evalúa de forma determinista la política de reanudación en las 10 ventanas de caída (F12).
   */
  public evaluateCrashWindow(
    stage:
      | "after_claim"
      | "after_lease"
      | "before_agent_run"
      | "after_agent_run"
      | "during_agent_step"
      | "before_tool"
      | "after_tool_authorization"
      | "after_tool_execution"
      | "before_job_completion"
      | "after_job_completion",
    context: {
      hasActiveLease?: boolean;
      agentRunExists?: boolean;
      agentRunStatus?: string;
      completedStepsCount?: number;
      toolIdempotencyKeyCommitted?: boolean;
      jobRunStatus?: string;
    }
  ): {
    canResume: boolean;
    recoveryAction:
      | "requeue_job"
      | "claim_and_execute"
      | "resume_agent_run"
      | "execute_next_step"
      | "complete_job_run"
      | "noop_already_terminal";
    idempotencyEnforced: boolean;
  } {
    switch (stage) {
      case "after_claim":
      case "after_lease":
        return {
          canResume: true,
          recoveryAction: "requeue_job",
          idempotencyEnforced: true,
        };
      case "before_agent_run":
        return {
          canResume: true,
          recoveryAction: "claim_and_execute",
          idempotencyEnforced: true,
        };
      case "after_agent_run":
        return {
          canResume: true,
          recoveryAction: "resume_agent_run",
          idempotencyEnforced: true,
        };
      case "during_agent_step":
      case "before_tool":
        return {
          canResume: true,
          recoveryAction: "execute_next_step",
          idempotencyEnforced: true,
        };
      case "after_tool_authorization":
        return {
          canResume: true,
          recoveryAction: "execute_next_step",
          idempotencyEnforced: true,
        };
      case "after_tool_execution":
        return {
          canResume: true,
          recoveryAction: "execute_next_step",
          idempotencyEnforced: Boolean(context.toolIdempotencyKeyCommitted),
        };
      case "before_job_completion":
        return {
          canResume: true,
          recoveryAction: "complete_job_run",
          idempotencyEnforced: true,
        };
      case "after_job_completion":
      default:
        return {
          canResume: false,
          recoveryAction: "noop_already_terminal",
          idempotencyEnforced: true,
        };
    }
  }
}
