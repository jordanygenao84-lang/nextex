/**
 * NEXTEХ Durable Jobs — Lease & Heartbeat Manager (Fase 4.6)
 * Control de presupuesto de ejecución episódica serverless y renovación de leases.
 */

import { defaultJobQueue } from "../queue/queue";

export interface LeaseManagerOptions {
  maxInvocationMs?: number; // Presupuesto de invocación (por defecto 45,000 ms)
  safetyMarginMs?: number;  // Margen de seguridad para salida y checkpoint (15,000 ms)
  heartbeatIntervalMs?: number; // Frecuencia de heartbeat (15,000 ms)
  leaseDurationSeconds?: number; // Duración de lease en base de datos (60 s)
}

export class LeaseManager {
  private startTime: number;
  private maxInvocationMs: number;
  private safetyMarginMs: number;
  private heartbeatIntervalMs: number;
  private leaseDurationSeconds: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private budgetTimer: NodeJS.Timeout | null = null;
  private budgetAbortController: AbortController;
  private isAlive: boolean = true;

  constructor(options?: LeaseManagerOptions) {
    this.startTime = Date.now();
    this.maxInvocationMs = options?.maxInvocationMs || 45000;
    this.safetyMarginMs = options?.safetyMarginMs || 15000;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs || 15000;
    this.leaseDurationSeconds = options?.leaseDurationSeconds || 60;
    this.budgetAbortController = new AbortController();

    const budgetThresholdMs = Math.max(0, this.maxInvocationMs - this.safetyMarginMs);
    this.budgetTimer = setTimeout(() => {
      if (this.isAlive && !this.budgetAbortController.signal.aborted) {
        this.budgetAbortController.abort(new Error("WORKER_BUDGET_EXPIRED"));
      }
    }, budgetThresholdMs);

    if (typeof this.budgetTimer?.unref === "function") {
      this.budgetTimer.unref();
    }
  }

  /**
   * Indica si el presupuesto de tiempo de ejecución del worker está próximo a agotarse.
   */
  public isBudgetExpiring(): boolean {
    if (this.budgetAbortController.signal.aborted) return true;
    const elapsed = Date.now() - this.startTime;
    const expiring = elapsed >= this.maxInvocationMs - this.safetyMarginMs;
    if (expiring && !this.budgetAbortController.signal.aborted) {
      this.budgetAbortController.abort(new Error("WORKER_BUDGET_EXPIRED"));
    }
    return expiring;
  }

  /**
   * Obtiene la señal de aborto que se dispara al alcanzarse el umbral de seguridad del presupuesto.
   */
  public getBudgetSignal(): AbortSignal {
    return this.budgetAbortController.signal;
  }

  /**
   * Dispara inmediatamente la señal de expiración del presupuesto (para pruebas o interrupción forzada).
   */
  public triggerBudgetExceeded() {
    if (!this.budgetAbortController.signal.aborted) {
      this.budgetAbortController.abort(new Error("WORKER_BUDGET_EXPIRED"));
    }
  }

  /**
   * Milisegundos restantes antes del umbral de seguridad de la invocación.
   */
  public getRemainingTimeMs(): number {
    const elapsed = Date.now() - this.startTime;
    const remaining = this.maxInvocationMs - this.safetyMarginMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Inicia el envío periódico de heartbeats mientras la invocación HTTP siga viva.
   */
  public startHeartbeat(
    runId: string,
    workerId: string,
    fencingToken: number | bigint,
    supabase?: any
  ) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.isAlive = true;

    this.heartbeatTimer = setInterval(async () => {
      if (!this.isAlive) return;
      try {
        const ok = await defaultJobQueue.heartbeat(
          runId,
          workerId,
          fencingToken,
          this.leaseDurationSeconds,
          supabase
        );
        if (!ok) {
          // Si el heartbeat fue rechazado (por ejemplo, lease tomado por otro worker), marcar terminación
          this.isAlive = false;
          this.stopHeartbeat();
        }
      } catch {
        // Error de red transitorio; se reintentará en el siguiente intervalo
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * Detiene el timer de heartbeat. OBLIGATORIO llamarlo antes de retornar la respuesta HTTP.
   */
  public stopHeartbeat() {
    this.isAlive = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.budgetTimer) {
      clearTimeout(this.budgetTimer);
      this.budgetTimer = null;
    }
  }

  /**
   * Verifica si el worker sigue teniendo autoridad activa en el lease.
   */
  public hasAuthority(): boolean {
    return this.isAlive;
  }
}
