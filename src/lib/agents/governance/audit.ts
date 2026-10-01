/**
 * NEXTEХ Agent Core — Authorization Auditor (Fase 4.4)
 * Registro auditable de decisiones de autorización y gobernanza.
 * REGLA ABSOLUTA: CERO almacenamiento de chain-of-thought, reflexiones o prompts privados.
 */

import { AuthorizationAuditLogEntry, AuthorizationDecision } from "../types";
import { sanitizeText } from "@/lib/omniengine/security/sanitizer";

export class AuthorizationAuditor {
  /**
   * Registra una decisión formal de autorización en la tabla de auditoría.
   */
  public async logDecision(
    entry: Omit<AuthorizationAuditLogEntry, "id" | "created_at">,
    supabaseClient?: any
  ): Promise<void> {
    // Sanitización de razón para evitar fuga de tokens o secretos
    const sanitizedReason = sanitizeText(entry.reason);

    const record: AuthorizationAuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      workspace_id: entry.workspace_id,
      actor_id: entry.actor_id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      decision: entry.decision,
      reason: sanitizedReason,
      evaluated_role: entry.evaluated_role || null,
      evaluated_permissions: entry.evaluated_permissions || null,
      agent_id: entry.agent_id || null,
      run_id: entry.run_id || null,
      step_id: entry.step_id || null,
      tool_id: entry.tool_id || null,
      tool_version: entry.tool_version || null,
      payload_hash: entry.payload_hash || null,
      created_at: new Date().toISOString(),
    };

    if (supabaseClient) {
      try {
        await supabaseClient.from("authorization_audit_log").insert({
          id: record.id,
          workspace_id: record.workspace_id,
          actor_id: record.actor_id,
          action: record.action,
          resource_type: record.resource_type,
          resource_id: record.resource_id,
          decision: record.decision,
          reason: record.reason,
          evaluated_role: record.evaluated_role,
          evaluated_permissions: record.evaluated_permissions,
          agent_id: record.agent_id,
          run_id: record.run_id,
          step_id: record.step_id,
          tool_id: record.tool_id,
          tool_version: record.tool_version,
          payload_hash: record.payload_hash,
        });
      } catch (err) {
        // La auditoría fallida no debe colapsar la base de datos, pero sí reportarse
        console.error("Fallo al escribir en authorization_audit_log:", err);
      }
    }
  }
}

export const defaultAuthorizationAuditor = new AuthorizationAuditor();
