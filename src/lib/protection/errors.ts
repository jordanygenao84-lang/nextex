import crypto from "crypto";

export interface ErrorEventRecord {
  id: string;
  client_id: string;
  fingerprint: string;
  error_type: string | null;
  message: string;
  detail: Record<string, any>;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

export interface ErrorSummary {
  total_groups: number;
  occurrences_24h: number;
}

/**
 * Normaliza el mensaje de error para cálculo de fingerprint:
 * - Recorta a 200 caracteres.
 * - Reemplaza cada secuencia de dígitos por '0' para agrupar errores con IDs o números variables.
 */
export function normalizeErrorMessage(message: string): string {
  if (!message || typeof message !== "string") {
    return "";
  }
  const sliced = message.slice(0, 200);
  return sliced.replace(/\d+/g, "0");
}

/**
 * Calcula el fingerprint SHA-256 de un error:
 * sha256(client_id + '|' + error_type + '|' + mensaje normalizado)
 */
export function calculateErrorFingerprint(
  clientId: string,
  errorType: string | null | undefined,
  message: string
): string {
  const normType = errorType ? String(errorType).trim() : "";
  const normMsg = normalizeErrorMessage(message);
  const raw = `${clientId}|${normType}|${normMsg}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Parámetros de URL cuyo valor nunca debe guardarse ni mostrarse: llaves
 * embebibles, claves de sitio y credenciales que viajan como query param
 * (p. ej. las URLs bloqueadas de reportes CSP). Patrón [REDACTED] igual que
 * la sanitización de auditoría. Solo nombres de parámetro genéricos: aquí no
 * se escribe ningún valor real de llave.
 */
const SENSITIVE_URL_PARAMS = new Set([
  "key",
  "embed_key",
  "embedkey",
  "site_key",
  "sitekey",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "auth",
  "secret",
  "password",
  "session",
  "session_key",
]);

/** Claves de objeto cuyo valor se redacta (mismo patrón que auditoría). */
const SENSITIVE_OBJECT_KEYS = new Set([
  "token",
  "secret",
  "password",
  "api_key",
  "apikey",
  "embed_key",
  "site_key",
  "auth",
]);

/**
 * Redacta los parámetros sensibles de las URLs que aparezcan dentro de un
 * texto (p. ej. una blockedURI de CSP con la llave del widget en el query).
 * Si una URL no se puede parsear, se devuelve intacta: esta función nunca
 * lanza excepciones.
 */
export function redactSensitiveUrlParams(text: string): string {
  if (!text || typeof text !== "string") return text;
  if (!text.includes("://") && !text.includes("?")) return text;
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (urlText) => {
    try {
      const parsed = new URL(urlText);
      let changed = false;
      for (const name of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_URL_PARAMS.has(name.toLowerCase())) {
          parsed.searchParams.set(name, "[REDACTED]");
          changed = true;
        }
      }
      return changed ? parsed.toString() : urlText;
    } catch {
      return urlText;
    }
  });
}

/**
 * Sanitiza recursivamente un valor de error (mensaje o detail) antes de
 * guardarlo o mostrarlo: redacta parámetros sensibles de URLs y valores bajo
 * claves sensibles, sin tocar el resto. Nunca lanza excepciones.
 */
export function sanitizeErrorValue(val: any): any {
  try {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return redactSensitiveUrlParams(val);
    if (Array.isArray(val)) return val.map((item) => sanitizeErrorValue(item));
    if (typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_OBJECT_KEYS.has(k.toLowerCase())) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = sanitizeErrorValue(v);
        }
      }
      return out;
    }
    return val;
  } catch {
    return val;
  }
}
