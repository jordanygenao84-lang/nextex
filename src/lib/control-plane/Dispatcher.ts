/**
 * NEXTEХ (Nexora Texter) — Dispatcher (Fase 4.10-D)
 * Motor de despacho desacoplado multi-instancia y tolerante a fallos.
 *
 * RESPONSABILIDAD EXCLUSIVA:
 * 1. Detectar trabajo disponible en cola.
 * 2. Seleccionar workers HEALTHY con capabilities compatibles.
 * 3. Ejecutar el reclamo atómico mediante RPC `claim_job_run_v2`.
 * 4. Recibir el lease y fencing token autoritativo.
 * 5. Entregar el JobRun al Worker Runtime mediante callback/canal.
 * 6. Aplicar backoff con jitter ante colas vacías o saturación.
 * 7. Gestionar parada ordenada (Graceful Shutdown).
 *
 * PROHIBICIÓN ABSOLUTA:
 * El Dispatcher NO ejecuta Agents, Tools, modelos de AI ni side-effects externos.
 */

import { randomUUID } from "crypto";
import {
  Worker,
  WorkerLease,
  DispatcherConfig,
  DispatchMetrics,
  DispatcherStatus,
  JobRunDispatchEvent,
  ClaimJobV2Result,
  ControlPlaneError,
} from "./types";

export type JobRunDispatchHandler = (event: JobRunDispatchEvent) => Promise<void> | void;

export class Dispatcher {
  private static globalDrainActive = false;
  private static drainingWorkspaces = new Set<string>();

  public static setGlobalDrain(active: boolean): void {
    Dispatcher.globalDrainActive = active;
  }

  public static isGlobalDrain(): boolean {
    return Dispatcher.globalDrainActive;
  }

  public static drainWorkspace(workspaceId: string): void {
    Dispatcher.drainingWorkspaces.add(workspaceId);
  }

  public static resumeWorkspace(workspaceId: string): void {
    Dispatcher.drainingWorkspaces.delete(workspaceId);
  }

  public static isWorkspaceDraining(workspaceId: string): boolean {
    return Dispatcher.drainingWorkspaces.has(workspaceId);
  }

  public readonly id: string;
  private readonly workspaceId: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly maxClaimsPerTick: number;
  private readonly claimLeaseSeconds: number;
  private readonly jitterRatio: number;

  private status: DispatcherStatus = "IDLE";
  private isRunning = false;
  private currentBackoffMs: number;
  private sleepTimeout: NodeJS.Timeout | null = null;
  private dispatchHandler: JobRunDispatchHandler | null = null;

  private metrics: DispatchMetrics = {
    cyclesTotal: 0,
    claimsAttempted: 0,
    claimsSucceeded: 0,
    claimsRejected: 0,
    emptyPollsCount: 0,
    errorsCount: 0,
    lastCycleAt: null,
    lastClaimAt: null,
    consecutiveEmptyPolls: 0,
  };

  constructor(
    private readonly supabaseClient: any,
    config: DispatcherConfig
  ) {
    if (!config.workspaceId) {
      throw new ControlPlaneError("workspaceId es obligatorio para inicializar el Dispatcher", "PERMANENT");
    }

    this.workspaceId = config.workspaceId;
    this.id = config.dispatcherId || `dispatcher-${randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.maxPollIntervalMs = config.maxPollIntervalMs ?? 15000;
    this.maxClaimsPerTick = config.maxClaimsPerTick ?? 5;
    this.claimLeaseSeconds = config.claimLeaseSeconds ?? 60;
    this.jitterRatio = config.jitterRatio ?? 0.2;
    this.currentBackoffMs = this.pollIntervalMs;
  }

  /**
   * Registra el callback de entrega al que se derivan los JobRuns reclamados.
   */
  public onDispatch(handler: JobRunDispatchHandler): void {
    this.dispatchHandler = handler;
  }

  /**
   * Obtiene métricas en tiempo real del Dispatcher sin exponer secretos ni tokens.
   */
  public getMetrics(): Readonly<DispatchMetrics> {
    return { ...this.metrics };
  }

  /**
   * Obtiene el estado operativo actual del Dispatcher.
   */
  public getStatus(): DispatcherStatus {
    return this.status;
  }

  /**
   * Ejecuta un único ciclo de despacho (Tick puntual).
   * Útil para invocaciones serverless, cron jobs o pruebas unitarias controladas.
   */
  public async tick(): Promise<{ claimsMade: number; eligibleWorkersFound: number }> {
    this.metrics.cyclesTotal++;
    this.metrics.lastCycleAt = new Date().toISOString();

    if (!this.supabaseClient) {
      throw new ControlPlaneError("Supabase client no configurado en Dispatcher", "PERMANENT");
    }

    try {
      this.status = "POLLING";

      // 0. Respetar congelamiento por Draining Global o Draining de Workspace (G12, G13, G16)
      if (Dispatcher.globalDrainActive || Dispatcher.drainingWorkspaces.has(this.workspaceId)) {
        this.metrics.consecutiveEmptyPolls++;
        this.status = "BACKOFF";
        return { claimsMade: 0, eligibleWorkersFound: 0 };
      }

      // 1. Descubrir Workers estrictamente HEALTHY en el Workspace del Dispatcher
      // REGLA CRÍTICA: Dispatcher NUNCA selecciona DRAINING, STOPPED, STALE ni QUARANTINED.
      const { data: workersData, error: workersErr } = await this.supabaseClient
        .from("workers")
        .select("*")
        .eq("workspace_id", this.workspaceId)
        .eq("status", "HEALTHY")
        .order("current_concurrency", { ascending: true });

      if (workersErr) {
        throw ControlPlaneError.classify(workersErr);
      }

      const eligibleWorkers = (workersData || []) as Worker[];

      // Filtrar aquellos que tienen capacidad aparente en el snapshot
      const availableWorkers = eligibleWorkers.filter(
        (w) => w.current_concurrency < w.max_concurrency
      );

      if (availableWorkers.length === 0) {
        this.metrics.consecutiveEmptyPolls++;
        this.metrics.emptyPollsCount++;
        this.status = "BACKOFF";
        return { claimsMade: 0, eligibleWorkersFound: 0 };
      }

      this.status = "DISPATCHING";
      let claimsCount = 0;

      // 2. Intentar reclamos atómicos mediante `claim_job_run_v2`
      for (const worker of availableWorkers) {
        if (claimsCount >= this.maxClaimsPerTick) break;

        this.metrics.claimsAttempted++;

        // Delegar claim exclusivamente al Control Plane en PostgreSQL (Atomic claim + SKIP LOCKED)
        const claimResult = await this.claimJobV2(worker.id, this.claimLeaseSeconds);

        if (claimResult.success && claimResult.claimed && claimResult.run && claimResult.lease) {
          claimsCount++;
          this.metrics.claimsSucceeded++;
          this.metrics.lastClaimAt = new Date().toISOString();
          this.metrics.consecutiveEmptyPolls = 0;

          // Entregar JobRun al worker mediante el handler registrado
          if (this.dispatchHandler) {
            const dispatchEvent: JobRunDispatchEvent = {
              jobRun: claimResult.run,
              lease: claimResult.lease,
              worker,
              fencingToken: claimResult.lease.fencing_token,
              dispatchedAt: new Date().toISOString(),
            };

            try {
              await this.dispatchHandler(dispatchEvent);
            } catch (handlerErr) {
              // El Dispatcher no se detiene si un worker falla al recibir
              this.metrics.errorsCount++;
            }
          }
        } else {
          // No había trabajo disponible o hubo contención concurrentemente resuelta
          this.metrics.claimsRejected++;
        }
      }

      if (claimsCount === 0) {
        this.metrics.consecutiveEmptyPolls++;
        this.metrics.emptyPollsCount++;
        this.status = "BACKOFF";
      } else {
        this.status = "IDLE";
      }

      return { claimsMade: claimsCount, eligibleWorkersFound: availableWorkers.length };
    } catch (err: any) {
      this.metrics.errorsCount++;
      this.status = "BACKOFF";
      throw ControlPlaneError.classify(err);
    }
  }

  /**
   * Inicia el bucle continuo del Dispatcher con control de backoff exponencial y jitter.
   * Totalmente protegido contra bucles busy-loop.
   */
  public async start(abortSignal?: AbortSignal): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => this.stop(), { once: true });
    }

    const runLoop = async () => {
      while (this.isRunning && (!abortSignal || !abortSignal.aborted)) {
        try {
          const { claimsMade } = await this.tick();

          if (claimsMade > 0) {
            // Se encontró y despachó trabajo: resetear backoff a intervalo base
            this.currentBackoffMs = this.pollIntervalMs;
          } else {
            // Cola vacía o capacidad saturada: incrementar backoff exponencial
            this.currentBackoffMs = Math.min(
              this.maxPollIntervalMs,
              Math.floor(this.currentBackoffMs * 1.5)
            );
          }
        } catch (err) {
          // En caso de error transitorio, incrementar backoff
          this.currentBackoffMs = Math.min(
            this.maxPollIntervalMs,
            Math.floor(this.currentBackoffMs * 2)
          );
        }

        if (this.isRunning) {
          // Aplicar Jitter para desincronizar múltiples dispatchers concurrentes
          const jitter = Math.floor(this.currentBackoffMs * this.jitterRatio * (Math.random() * 2 - 1));
          const sleepDuration = Math.max(100, this.currentBackoffMs + jitter);

          await new Promise<void>((resolve) => {
            this.sleepTimeout = setTimeout(resolve, sleepDuration);
          });
        }
      }

      this.status = "STOPPED";
    };

    runLoop().catch(() => {});
  }

  /**
   * Parada ordenada (Graceful Shutdown) del Dispatcher.
   */
  public stop(): void {
    this.isRunning = false;
    this.status = "STOPPED";
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = null;
    }
  }

  /**
   * Invoca la RPC certificada `claim_job_run_v2` en PostgreSQL.
   */
  private async claimJobV2(
    workerId: string,
    leaseSeconds: number,
    requiredCapabilities?: string[]
  ): Promise<ClaimJobV2Result> {
    const { data, error } = await this.supabaseClient.rpc("claim_job_run_v2", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
      p_required_capabilities: requiredCapabilities || null,
    });

    if (error) {
      throw ControlPlaneError.classify(error);
    }

    return (data || { success: false, claimed: false }) as ClaimJobV2Result;
  }
}
