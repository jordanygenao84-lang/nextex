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
  private isAlive: boolean = true;

  constructor(options?: LeaseManagerOptions) {
    this.startTime = Date.now();
    this.maxInvocationMs = options?.maxInvocationMs || 45000;
    this.safetyMarginMs = options?.safetyMarginMs || 15000;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs || 15000;
    this.leaseDurationSeconds = options?.leaseDurationSeconds || 60;
  }

  /**
   * Indica si el presupuesto de tiempo de ejecución del worker está próximo a agotarse.
   */
  public isBudgetExpiring(): boolean {
    const elapsed = Date.now() - this.startTime;
    return elapsed >= this.maxInvocationMs - this.safetyMarginMs;
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
  }

  /**
   * Verifica si el worker sigue teniendo autoridad activa en el lease.
   */
  public hasAuthority(): boolean {
    return this.isAlive;
  }
}
