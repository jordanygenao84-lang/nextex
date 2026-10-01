/**
 * NEXTEХ OmniEngine — Rate Limiter
 * Protección contra ráfagas y denegación de servicio por usuario y workspace.
 */

import { OmniEngineError, OmniErrorCodes } from "../types/errors";

interface RateLimitBucket {
  timestamps: number[];
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly windowMs: number;
  private readonly maxPerWindow: number;

  constructor(maxPerWindow = 60, windowMs = 60000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  /**
   * Verifica y consume un slot en la ventana de tiempo.
   * Lanza OmniEngineError (RATE_LIMIT_EXCEEDED) si se supera el límite.
   */
  public checkLimit(identifier: string) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let bucket = this.buckets.get(identifier);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(identifier, bucket);
    }

    // Filtrar timestamps fuera de la ventana
    bucket.timestamps = bucket.timestamps.filter((ts: number) => ts > windowStart);

    if (bucket.timestamps.length >= this.maxPerWindow) {
      const oldest = bucket.timestamps[0];
      const waitTimeSec = Math.ceil((oldest + this.windowMs - now) / 1000);
      throw new OmniEngineError({
        code: OmniErrorCodes.RATE_LIMIT_EXCEEDED,
        message: `Has alcanzado el límite de peticiones concurrentes. Por favor espera ${waitTimeSec} segundo(s) antes de reintentar.`,
        statusCode: 429,
        retryable: true,
      });
    }

    bucket.timestamps.push(now);
  }

  /**
   * Limpieza periódica de buckets inactivos para evitar fugas de memoria.
   */
  public cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    this.buckets.forEach((bucket, key) => {
      bucket.timestamps = bucket.timestamps.filter((ts: number) => ts > windowStart);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    });
  }
}

export const defaultRateLimiter = new RateLimiter();
