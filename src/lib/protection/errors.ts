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
