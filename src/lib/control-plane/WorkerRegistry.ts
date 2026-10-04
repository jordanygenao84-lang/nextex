/**
 * NEXTEХ (Nexora Texter) — WorkerRegistry (Fase 4.10-C)
 * Capa de aplicación autoritativa para el ciclo de vida de workers,
 * heartbeats controlados, drenado, cuarentena y recuperación durable.
 * Todas las mutaciones delegan en las RPCs transaccionales certificadas de PostgreSQL.
 */

import { randomUUID } from "crypto";
import {
  Worker,
  WorkerStatus,
  RegisterWorkerParams,
  RegisterWorkerResult,
  HeartbeatWorkerResult,
  DrainWorkerResult,
  QuarantineWorkerResult,
  ReleaseQuarantineResult,
  ReleaseWorkerLeaseResult,
  RecoverWorkerJobsResult,
  ControlPlaneError,
} from "./types";

export interface HeartbeatLoopOptions {
  intervalMs?: number; // Default 10000ms (10s)
  maxFailures?: number; // Default 3
  abortSignal?: AbortSignal;
  onAnomalousState?: (status: WorkerStatus, error?: any) => void;
  onHeartbeatSuccess?: (status: WorkerStatus, concurrency: number) => void;
}

export interface HeartbeatController {
  stop: () => void;
  isActive: () => boolean;
  getLastHeartbeatAt: () => Date | null;
  getConsecutiveFailures: () => number;
}

export class WorkerRegistry {
  private activeHeartbeatLoops: Map<string, { stop: () => void }> = new Map();

  constructor(private supabaseClient?: any) {}

  /**
   * Genera una nueva identidad de instancia efímera para un boot/restart.
   * Garantiza que workers antiguos no puedan continuar operando bajo la misma identidad.
   */
  public generateInstanceIdentity(workerIdentity: string): string {
    const cleanId = workerIdentity.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    return `${cleanId}-inst-${randomUUID()}`;
  }

  /**
   * Registra o re-registra un worker en el Control Plane.
   * Si es un restart, se debe suministrar una nueva instanceIdentity.
   */
  public async register(params: RegisterWorkerParams): Promise<RegisterWorkerResult> {
    try {
      const instanceIdentity = params.instanceIdentity || this.generateInstanceIdentity(params.workerIdentity);

      if (!this.supabaseClient) {
        throw new ControlPlaneError("Supabase client no configurado en WorkerRegistry", "PERMANENT");
      }

      const { data, error } = await this.supabaseClient.rpc("register_worker", {
        p_workspace_id: params.workspaceId,
        p_worker_identity: params.workerIdentity,
        p_instance_identity: instanceIdentity,
        p_version: params.version || "1.0.0",
        p_capabilities: params.capabilities || ["ai", "database", "integrations", "http"],
        p_max_concurrency: params.maxConcurrency || 5,
        p_metadata: params.metadata || {},
      });

      if (error) {
        throw ControlPlaneError.classify(error);
      }

      if (!data?.success) {
        return {
          success: false,
          error_code: data?.error_code || "REGISTRATION_FAILED",
          error_message: data?.error_message || "Fallo en registro de worker",
        };
      }

      return {
        success: true,
        worker: data.worker as Worker,
      };
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Envía un latido puntual para validar presencia, detectar desfasajes y reconciliar concurrencia.
   */
  public async heartbeat(workerId: string, instanceIdentity: string): Promise<HeartbeatWorkerResult> {
    try {
      if (!this.supabaseClient) {
        throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");
      }

      const { data, error } = await this.supabaseClient.rpc("heartbeat_worker", {
        p_worker_id: workerId,
        p_instance_identity: instanceIdentity,
      });

      if (error) {
        throw ControlPlaneError.classify(error);
      }

      return data as HeartbeatWorkerResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Inicia un ciclo de heartbeat periódico y controlado.
   * Evita solapamiento concurrente utilizando un bucle secuencial (while + sleep)
   * con soporte para AbortSignal y detección inmediata de anomalías de instancia o cuarentena.
   */
  public startHeartbeatLoop(
    workerId: string,
    instanceIdentity: string,
    options: HeartbeatLoopOptions = {}
  ): HeartbeatController {
    const intervalMs = options.intervalMs ?? 10000;
    const maxFailures = options.maxFailures ?? 3;
    let isRunning = true;
    let consecutiveFailures = 0;
    let lastHeartbeatAt: Date | null = null;
    let sleepTimeout: NodeJS.Timeout | null = null;

    const stop = () => {
      isRunning = false;
      if (sleepTimeout) {
        clearTimeout(sleepTimeout);
        sleepTimeout = null;
      }
      this.activeHeartbeatLoops.delete(workerId);
    };

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => stop(), { once: true });
    }

    const runLoop = async () => {
      while (isRunning && (!options.abortSignal || !options.abortSignal.aborted)) {
        try {
          const res = await this.heartbeat(workerId, instanceIdentity);

          if (res.success) {
            consecutiveFailures = 0;
            lastHeartbeatAt = new Date();
            if (options.onHeartbeatSuccess && res.status) {
              options.onHeartbeatSuccess(res.status, res.current_concurrency ?? 0);
            }
          } else {
            consecutiveFailures++;
            // Errores no recuperables: detener el bucle de inmediato
            if (res.error_code === "INSTANCE_MISMATCH" || res.error_code === "WORKER_QUARANTINED" || res.status === "QUARANTINED") {
              if (options.onAnomalousState) {
                options.onAnomalousState(res.status || "QUARANTINED", res);
              }
              stop();
              break;
            }
          }
        } catch (err: any) {
          consecutiveFailures++;
          const classified = ControlPlaneError.classify(err);
          if (classified.code === "QUARANTINE" || classified.code === "AUTHORIZATION") {
            if (options.onAnomalousState) {
              options.onAnomalousState("QUARANTINED", err);
            }
            stop();
            break;
          }
        }

        if (consecutiveFailures >= maxFailures) {
          if (options.onAnomalousState) {
            options.onAnomalousState("STALE", new Error(`Max consecutive heartbeat failures reached (${maxFailures})`));
          }
        }

        // Espera controlada con cálculo de jitter
        if (isRunning) {
          await new Promise<void>((resolve) => {
            const jitter = Math.floor(Math.random() * (intervalMs * 0.1));
            sleepTimeout = setTimeout(resolve, intervalMs + jitter);
          });
        }
      }
    };

    // Lanzar el bucle asíncrono desacoplado
    runLoop().catch(() => {});

    const controller: HeartbeatController = {
      stop,
      isActive: () => isRunning,
      getLastHeartbeatAt: () => lastHeartbeatAt,
      getConsecutiveFailures: () => consecutiveFailures,
    };

    this.activeHeartbeatLoops.set(workerId, { stop });
    return controller;
  }

  /**
   * Inicia el drenado controlado de un worker.
   * Si no posee leases activos, transiciona inmediatamente a STOPPED.
   */
  public async drain(workerId: string, actorId?: string, reason?: string): Promise<DrainWorkerResult> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("drain_worker", {
        p_worker_id: workerId,
        p_actor_id: actorId || "system",
        p_reason: reason || null,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as DrainWorkerResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Coloca un worker en cuarentena operativa, revocando leases activos y re-encolando jobs con fencing incrementado.
   */
  public async quarantine(workerId: string, actorId: string, reason: string): Promise<QuarantineWorkerResult> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("quarantine_worker", {
        p_worker_id: workerId,
        p_actor_id: actorId,
        p_reason: reason,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as QuarantineWorkerResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Libera un worker de cuarentena, transicionándolo a STOPPED para obligar a un reinicio limpio.
   */
  public async releaseQuarantine(workerId: string, actorId: string): Promise<ReleaseQuarantineResult> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("release_worker_quarantine", {
        p_worker_id: workerId,
        p_actor_id: actorId,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as ReleaseQuarantineResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Detecta y marca workers con timeout de heartbeat como STALE.
   */
  public async markStale(timeoutSeconds: number = 90): Promise<number> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("mark_worker_stale", {
        p_heartbeat_timeout_seconds: timeoutSeconds,
      });

      if (error) throw ControlPlaneError.classify(error);
      return typeof data === "number" ? data : 0;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Libera un lease de worker validando su fencing token.
   */
  public async releaseLease(
    leaseId: string,
    workerId: string,
    fencingToken: bigint | number
  ): Promise<ReleaseWorkerLeaseResult> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("release_worker_lease", {
        p_lease_id: leaseId,
        p_worker_id: workerId,
        p_fencing_token: typeof fencingToken === "bigint" ? Number(fencingToken) : fencingToken,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as ReleaseWorkerLeaseResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Ejecuta la recuperación de jobs asociados a leases vencidos.
   */
  public async recoverJobs(batchSize: number = 20): Promise<RecoverWorkerJobsResult> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("recover_worker_jobs", {
        p_batch_size: batchSize,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as RecoverWorkerJobsResult;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Consulta los detalles de un worker por ID.
   */
  public async getWorker(workerId: string): Promise<Worker | null> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient
        .from("workers")
        .select("*")
        .eq("id", workerId)
        .maybeSingle();

      if (error) throw ControlPlaneError.classify(error);
      return data as Worker | null;
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Lista workers de un workspace con filtros opcionales de status y capabilities.
   */
  public async listWorkers(
    workspaceId: string,
    filter?: { status?: WorkerStatus; capability?: string }
  ): Promise<Worker[]> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      let query = this.supabaseClient
        .from("workers")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("registered_at", { ascending: false });

      if (filter?.status) {
        query = query.eq("status", filter.status);
      }

      if (filter?.capability) {
        query = query.contains("capabilities", [filter.capability]);
      }

      const { data, error } = await query;
      if (error) throw ControlPlaneError.classify(error);
      return (data || []) as Worker[];
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Cierre ordenado de todos los ciclos de heartbeat activos.
   */
  public async shutdown(): Promise<void> {
    this.activeHeartbeatLoops.forEach((loop) => {
      loop.stop();
    });
    this.activeHeartbeatLoops.clear();
  }

  /**
   * Solicita la cancelación formal de un JobRun delegando en la RPC autoritativa.
   */
  public async requestCancellation(params: {
    jobRunId: string;
    actorId?: string;
    reason?: string;
  }): Promise<{ success: boolean; status?: string; error_code?: string; error_message?: string }> {
    try {
      if (!this.supabaseClient) throw new ControlPlaneError("Supabase client no configurado", "PERMANENT");

      const { data, error } = await this.supabaseClient.rpc("request_job_cancellation", {
        p_job_run_id: params.jobRunId,
        p_actor_id: params.actorId || "system",
        p_reason: params.reason || null,
      });

      if (error) throw ControlPlaneError.classify(error);
      return data as { success: boolean; status?: string; error_code?: string; error_message?: string };
    } catch (err: any) {
      throw ControlPlaneError.classify(err);
    }
  }
}

