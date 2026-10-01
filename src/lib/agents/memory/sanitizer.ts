/**
 * NEXTEХ Agent Core — Memory Sanitizer (Fase 4.5)
 * Sanitización activa y defensa en profundidad para redactar secretos antes
 * de generar embeddings y antes de persistir recuerdos en base de datos.
 */

export interface SanitizationResult {
  sanitized: string;
  hasRedactions: boolean;
  redactedPatternsCount: number;
}

export class MemorySanitizer {
  private static readonly SECRET_PATTERNS: RegExp[] = [
    // 1. OpenAI API Keys (legacy y modernas sk-proj-...)
    /sk-[a-zA-Z0-9_\-]{20,}/g,
    /sk-proj-[a-zA-Z0-9_\-]{20,}/g,

    // 2. GitHub Personal Access Tokens y OAuth tokens
    /gh[pousr]_[a-zA-Z0-9]{30,}/g,

    // 3. JSON Web Tokens (JWT)
    /eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/g,

    // 4. AWS Access Key IDs
    /\bAKIA[0-9A-Z]{16}\b/g,

    // 5. Claves privadas PEM / RSA
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,

    // 6. Generic Bearer Tokens
    /Bearer\s+[a-zA-Z0-9_\.\-+=/]{20,}/gi,

    // 7. Password / Secret assignments en texto
    /(?:password|passwd|secret|api_key|apikey|auth_token)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,

    // 8. Slack Tokens
    /xox[baprs]-[0-9a-zA-Z]{10,}/g,

    // 9. Stripe API Keys
    /(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}/g,
  ];

  /**
   * Sanitiza una cadena de texto redactando todos los secretos detectados.
   */
  public static sanitize(text: string): SanitizationResult {
    if (!text || typeof text !== "string") {
      return { sanitized: "", hasRedactions: false, redactedPatternsCount: 0 };
    }

    let sanitized = text;
    let count = 0;

    for (const pattern of this.SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(sanitized)) {
        pattern.lastIndex = 0;
        sanitized = sanitized.replace(pattern, (match) => {
          count++;
          return "[REDACTED_SECRET]";
        });
      }
    }

    return {
      sanitized,
      hasRedactions: count > 0,
      redactedPatternsCount: count,
    };
  }

  /**
   * Sanitiza un objeto de metadatos de forma recursiva.
   */
  public static sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return {};
    }

    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === "string") {
        cleaned[key] = this.sanitize(value).sanitized;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        cleaned[key] = this.sanitizeMetadata(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
}
