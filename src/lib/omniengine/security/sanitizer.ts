/**
 * NEXTEХ OmniEngine — Sanitizador de Seguridad y Secretos
 * Garantiza que ninguna API Key, token de servicio o JWT sea expuesto en logs, errores o clientes.
 */

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g, // Anthropic keys
  /AIza[0-9A-Za-z-_]{35}/g, // Google AI / Firebase keys
  /ghp_[a-zA-Z0-9]{30,}/g, // GitHub classic PAT
  /github_pat_[a-zA-Z0-9_]{40,}/g, // GitHub fine-grained PAT
  /sb_publishable_[a-zA-Z0-9_-]{20,}/g, // Supabase publishable
  /sb_secret_[a-zA-Z0-9_-]{20,}/g, // Supabase secret
  /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT tokens
  /Bearer\s+[A-Za-z0-9_.-]+/gi, // Bearer auth headers
];

export function sanitizeText(text: string): string {
  if (!text || typeof text !== "string") return text;
  let sanitized = text;

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
  }

  return sanitized;
}

export function sanitizeObject<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  try {
    const stringified = JSON.stringify(obj, (key, value) => {
      // Bloquear campos con nombres sensibles
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("password") ||
        lowerKey.includes("authorization")
      ) {
        if (typeof value === "string" && value.length > 0) {
          return "[REDACTED_SECRET]";
        }
      }
      if (typeof value === "string") {
        return sanitizeText(value);
      }
      return value;
    });

    return JSON.parse(stringified);
  } catch {
    return obj;
  }
}
