/**
 * NEXTEХ Observability — Sanitizador y Bounding de Atributos (Capa 1)
 * Protección estricta contra fuga de secretos, inyección JSON y sobrecarga de memoria.
 */

import { SpanAttributes } from "./types";

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /\btoken\b/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /service[-_]?role/i,
  /webhook[-_]?secret/i,
  /client[-_]?secret/i,
  /private[-_]?key/i,
  /bearer/i,
  /auth/i,
  /signature/i,
];

const PROHIBITED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

const MAX_DEPTH = 4;
const MAX_KEYS = 25;
const MAX_ARRAY_LENGTH = 50;
const MAX_STRING_LENGTH = 500;
const MAX_BYTE_SIZE = 4096;

/**
 * Determina si una clave coincide con algún patrón sensible.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Sanitiza recursivamente cualquier estructura de datos para telemetría.
 */
export function sanitizeAttributes(
  raw: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }

  // Primitivos simples
  if (typeof raw === "number" || typeof raw === "boolean") {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw === "string") {
    // Redactar si aparenta contener tokens jwt o secret keys
    if (raw.length > MAX_STRING_LENGTH) {
      return `${raw.slice(0, MAX_STRING_LENGTH)}... [TRUNCATED]`;
    }
    // Detección simple de bearer o tokens largos
    if (/^bearer\s+[a-zA-Z0-9._-]+/i.test(raw) || /^eyJ[a-zA-Z0-9_-]{20,}/.test(raw)) {
      return "[REDACTED_TOKEN]";
    }
    return raw;
  }

  if (typeof raw === "bigint") {
    return raw.toString();
  }

  // Protección contra profundidad máxima
  if (depth >= MAX_DEPTH) {
    return "[MAX_DEPTH_REACHED]";
  }

  // Fechas
  if (raw instanceof Date) {
    return raw.toISOString();
  }

  // Errores
  if (raw instanceof Error) {
    return {
      name: raw.name,
      message: raw.message.length > MAX_STRING_LENGTH
        ? `${raw.message.slice(0, MAX_STRING_LENGTH)}... [TRUNCATED]`
        : raw.message,
    };
  }

  // Arrays
  if (Array.isArray(raw)) {
    if (seen.has(raw)) {
      return "[CIRCULAR_REFERENCE]";
    }
    seen.add(raw);

    const boundedArray = raw.slice(0, MAX_ARRAY_LENGTH);
    const result = boundedArray.map((item) => sanitizeAttributes(item, depth + 1, seen));
    if (raw.length > MAX_ARRAY_LENGTH) {
      result.push(`[TRUNCATED_${raw.length - MAX_ARRAY_LENGTH}_ITEMS]`);
    }
    return result;
  }

  // Objetos
  if (typeof raw === "object") {
    if (seen.has(raw)) {
      return "[CIRCULAR_REFERENCE]";
    }
    seen.add(raw);

    const result: Record<string, unknown> = {};
    const entries = Object.entries(raw as Record<string, unknown>);
    let keyCount = 0;

    for (const [key, value] of entries) {
      // Protección contra Prototype Pollution
      if (PROHIBITED_PROPERTIES.has(key)) {
        continue;
      }

      if (keyCount >= MAX_KEYS) {
        result["_truncated_keys_count"] = entries.length - MAX_KEYS;
        break;
      }

      // Redacción por nombre de clave sensible
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED_SECRET]";
      } else {
        result[key] = sanitizeAttributes(value, depth + 1, seen);
      }

      keyCount++;
    }

    return result;
  }

  return "[UNSUPPORTED_TYPE]";
}

/**
 * Aplica la Capa 1 de attribute bounding, asegurando que el JSON serializado sea <= 4096 bytes.
 */
export function boundSpanAttributes(attributes?: SpanAttributes | null): SpanAttributes {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }

  const sanitized = sanitizeAttributes(attributes) as Record<string, unknown>;
  const jsonString = JSON.stringify(sanitized);
  const byteSize = Buffer.byteLength(jsonString, "utf8");

  if (byteSize <= MAX_BYTE_SIZE) {
    return sanitized as SpanAttributes;
  }

  // Si excede 4096 bytes tras sanitizar, realizar poda agresiva segura
  const pruned: Record<string, unknown> = {
    _pruned: true,
    _original_byte_size: byteSize,
  };

  for (const [k, v] of Object.entries(sanitized)) {
    if (typeof v === "number" || typeof v === "boolean" || v === null) {
      pruned[k] = v;
    } else if (typeof v === "string") {
      pruned[k] = v.length > 50 ? `${v.slice(0, 50)}... [PRUNED]` : v;
    }

    if (Buffer.byteLength(JSON.stringify(pruned), "utf8") > MAX_BYTE_SIZE - 200) {
      break;
    }
  }

  return pruned as SpanAttributes;
}
