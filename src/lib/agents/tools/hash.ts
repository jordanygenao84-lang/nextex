/**
 * NEXTEХ Agent Core — Generador de Hash Canónico de Integridad y Binding (Fase 4.3)
 * Binding determinista Anti-Replay y Anti-Tampering según RFC 8785 (JSON Canonicalization Scheme).
 * 
 * Regla de binding canónico:
 * canonicalBinding = run_id + ":" + step_id + ":" + tool_id + ":" + tool_version + ":" + canonicalJSON(params)
 * payload_hash = SHA256(canonicalBinding)
 */

import { createHash } from "crypto";

/**
 * Serializa de forma determinista y recursiva cualquier valor a JSON canónico (RFC 8785).
 * - Ordena todas las claves de los objetos lexicográficamente por código Unicode.
 * - Elimina espacios en blanco fuera de cadenas.
 * - Mantiene el orden exacto de los arrays.
 */
export function canonicalJSON(val: any): string {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val === "boolean" || typeof val === "number") {
    return JSON.stringify(val);
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return "[" + val.map((item) => canonicalJSON(item)).join(",") + "]";
  }
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(val[k])}`);
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(val);
}

/**
 * Calcula el hash SHA-256 canónico de binding para un paso operativo de herramienta.
 */
export function computeApprovalPayloadHash(
  runId: string,
  stepId: string,
  toolId: string,
  version: string,
  params: Record<string, any>
): string {
  const cJson = canonicalJSON(params || {});
  const canonicalBinding = `${runId}:${stepId}:${toolId}:${version}:${cJson}`;
  return createHash("sha256").update(canonicalBinding, "utf8").digest("hex");
}
