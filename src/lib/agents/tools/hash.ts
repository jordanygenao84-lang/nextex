/**
 * NEXTEХ Agent Core — Generador de Firma Criptográfica de Aprobación (Fase 4.3)
 * Binding determinista Anti-Replay y Anti-Tampering.
 */

import { createHash } from "crypto";

/**
 * Calcula el hash SHA-256 canónico e inmutable para una solicitud de aprobación.
 */
export function computeApprovalPayloadHash(
  runId: string,
  stepId: string,
  toolId: string,
  version: string,
  params: Record<string, any>
): string {
  const sortedKeys = Object.keys(params || {}).sort();
  const sortedObj: Record<string, any> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = params[k];
  }

  const canonicalJSON = JSON.stringify(sortedObj);
  const payloadString = `${runId}:${stepId}:${toolId}:${version}:${canonicalJSON}`;
  return createHash("sha256").update(payloadString).digest("hex");
}
