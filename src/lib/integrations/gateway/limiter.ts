/**
 * NEXTEХ Integration Gateway — Limiter & Sanitizer (Fase 4.7)
 * Control de tamaño de payload, fast-drop rate limiting server-side y sanitización de cabeceras.
 */

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  resetSeconds: number;
}

export class GatewayLimiter {
  // Almacén en memoria por instancia (fast-drop de primer nivel)
  private memoryStore: Map<string, { count: number; resetAt: number }> = new Map();

  /**
   * Valida si el tamaño del cuerpo excede el límite permitido.
   */
  public isPayloadOversized(sizeBytes: number, maxBytes: number = 262144): boolean {
    return sizeBytes > maxBytes;
  }

  /**
   * Fast-drop rate limiter server-side.
   * Ventana por defecto: 60 segundos, límite: 120 peticiones por endpoint.
   */
  public checkRateLimit(key: string, limit: number = 120, windowSeconds: number = 60): RateLimitResult {
    const now = Date.now();
    const entry = this.memoryStore.get(key);

    if (!entry || now > entry.resetAt) {
      this.memoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return {
        allowed: true,
        currentCount: 1,
        maxLimit: limit,
        resetSeconds: windowSeconds,
      };
    }

    entry.count += 1;
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    if (entry.count > limit) {
      return {
        allowed: false,
        currentCount: entry.count,
        maxLimit: limit,
        resetSeconds,
      };
    }

    return {
      allowed: true,
      currentCount: entry.count,
      maxLimit: limit,
      resetSeconds,
    };
  }

  /**
   * Sanitiza metadatos de cabeceras HTTP suprimiendo cookies, credenciales y secretos internos.
   */
  public sanitizeHeaders(headers: Headers): Record<string, string> {
    const safeHeaders: Record<string, string> = {};
    const prohibitedHeaders = [
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "x-secret",
      "proxy-authorization",
      "supabase-service-role",
    ];

    headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!prohibitedHeaders.includes(lower)) {
        safeHeaders[lower] = value;
      }
    });

    return safeHeaders;
  }
}

export const defaultGatewayLimiter = new GatewayLimiter();
