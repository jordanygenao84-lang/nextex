/**
 * NEXTEХ Agent Core — Approval Governance & JIT Revalidation (Fase 4.4)
 * Gestión formal de solicitudes HITL, binding criptográfico, control de self-approval
 * y tubería de revalidación Just-In-Time (JIT) antes de la ejecución física.
 */

import { computeApprovalPayloadHash } from "../tools/hash";
import { defaultPermissionEngine, PermissionEngine } from "./permissions";
import { defaultPolicyEngine, PolicyEngine } from "./policies";
import { defaultToolRegistry, ToolRegistry } from "../tools/registry";
import {
  ApprovalRequest,
  ApprovalStatus,
  CanonicalPermissionKey,
  Agent,
  AgentPolicy,
  ToolRiskLevel,
} from "../types";
import { AgentError, AgentErrorCodes } from "../types/errors";

export interface JITRevalidationContext {
  approvalId: string;
  approverId: string;
  expectedPayloadHash: string;
  decision: "approve" | "reject";
  comment?: string;
  supabaseClient?: any;
}

export interface JITRevalidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  stepId?: string;
  fencingToken?: number | bigint;
  leaseExpiresAt?: string;
  runId?: string;
  toolId?: string;
  toolVersion?: string;
  params?: Record<string, any>;
}

export class ApprovalGovernance {
  constructor(
    private permissions: PermissionEngine = defaultPermissionEngine,
    private policies: PolicyEngine = defaultPolicyEngine,
    private registry: ToolRegistry = defaultToolRegistry
  ) {}

  /**
   * Genera una entidad formal de ApprovalRequest ligada 1:1 al step_id.
   */
  public createApprovalRequest(
    workspaceId: string,
    runId: string,
    stepId: string,
    toolId: string,
    toolVersion: string,
    requesterId: string,
    riskLevel: ToolRiskLevel,
    params: Record<string, any>
  ): ApprovalRequest {
    const payloadHash = computeApprovalPayloadHash(
      runId,
      stepId,
      toolId,
      toolVersion,
      params
    );

    const requiredPermission = `tools.execute_${riskLevel}` as CanonicalPermissionKey;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // TTL 24 horas

    return {
      id: `appr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      workspace_id: workspaceId,
      run_id: runId,
      step_id: stepId,
      tool_id: toolId,
      tool_version: toolVersion,
      requester_id: requesterId,
      required_permission: requiredPermission,
      risk_level: riskLevel,
      payload_hash: payloadHash,
      status: "pending",
      approver_id: null,
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      expires_at: expiresAt,
    };
  }

  /**
   * Ejecuta la revalidación JIT y resuelve la aprobación mediante la RPC transaccional o simulación.
   * REGLA: APPROVED NO SIGNIFICA COMPLETED. El step pasa a 'running'.
   */
  public async resolveApproval(
    context: JITRevalidationContext,
    inMemoryData?: {
      approval: ApprovalRequest;
      agent: Agent;
      policy: AgentPolicy;
      requesterRole?: string;
      approverRole?: string;
      approverOverrides?: Map<string, "allow" | "deny">;
    }
  ): Promise<JITRevalidationResult> {
    const { approvalId, approverId, expectedPayloadHash, decision, comment, supabaseClient } = context;

    // 1. SI EXISTE CLIENTE SUPABASE, EJECUTAR LA RPC TRANSACCIONAL SECURITY DEFINER
    if (supabaseClient) {
      const { data: rpcResult, error: rpcErr } = await supabaseClient.rpc(
        "claim_agent_step_approval_v2",
        {
          p_approval_id: approvalId,
          p_expected_hash: expectedPayloadHash,
          p_decision: decision === "approve" ? "approved" : "rejected",
          p_comment: comment || null,
        }
      );

      if (rpcErr) {
        throw new AgentError({
          code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: `Error al ejecutar claim_agent_step_approval_v2: ${rpcErr.message}`,
          statusCode: 500,
        });
      }

      if (!rpcResult?.success) {
        const code = rpcResult?.error_code || AgentErrorCodes.TOOL_APPROVAL_INVALID;
        throw new AgentError({
          code,
          message: rpcResult?.error_message || "La aprobación fue denegada por la base de datos.",
          statusCode: code === AgentErrorCodes.TOOL_APPROVAL_REPLAY ? 409 : 403,
        });
      }

      return {
        valid: true,
        stepId: rpcResult.step_id,
        fencingToken: rpcResult.fencing_token,
        leaseExpiresAt: rpcResult.lease_expires_at,
      };
    }

    // 2. VERIFICACIÓN JIT EN MEMORIA (para pruebas unitarias y entornos desacoplados)
    if (!inMemoryData) {
      throw new AgentError({
        code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
        message: "No se suministraron datos de persistencia para la revalidación JIT.",
        statusCode: 500,
      });
    }

    const { approval, agent, policy, approverRole, approverOverrides } = inMemoryData;

    // Factor 1: Sesión
    if (!approverId) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sesión requerida.", statusCode: 401 });
    }

    // Factor 2: Estado y TTL
    if (approval.status !== "pending") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_REPLAY, message: "La solicitud ya fue procesada.", statusCode: 409 });
    }
    if (new Date(approval.expires_at).getTime() <= Date.now()) {
      approval.status = "expired";
      throw new AgentError({ code: AgentErrorCodes.APPROVAL_EXPIRED, message: "La solicitud ha expirado.", statusCode: 410 });
    }

    // Factor 3: Self-Approval
    if (approval.requester_id === approverId && policy.self_approval_mode !== "allowed") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_SELF_APPROVAL_BLOCKED,
        message: "Self-approval bloqueado: el iniciador del run no puede autorizar su propia solicitud.",
        statusCode: 403,
      });
    }

    // Factor 4: Permisos JIT del aprobador
    const approvePerm = await this.permissions.can(approverId, approval.workspace_id, "approvals.approve", {
      inMemoryOverrides: approverOverrides,
      inMemoryRole: (approverRole as any) || "member",
    });
    if (!approvePerm.allowed) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_UNAUTHORIZED, message: "Sin permiso para aprobar.", statusCode: 403 });
    }

    const riskPermKey = `tools.execute_${approval.risk_level}` as CanonicalPermissionKey;
    const riskPerm = await this.permissions.can(approverId, approval.workspace_id, riskPermKey, {
      inMemoryOverrides: approverOverrides,
      inMemoryRole: (approverRole as any) || "member",
    });
    if (!riskPerm.allowed) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_NOT_ALLOWED, message: `Aprobador sin permiso para '${riskPermKey}'.`, statusCode: 403 });
    }

    // Factor 5: Política de Agente
    if (!policy.allow_execution || agent.status !== "active") {
      throw new AgentError({ code: AgentErrorCodes.AGENT_EXECUTION_BLOCKED, message: "Agente bloqueado.", statusCode: 403 });
    }

    // Factor 6: Integridad Hash
    if (approval.payload_hash !== expectedPayloadHash) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, message: "Hash alterado.", statusCode: 400 });
    }

    // Factor 7: Herramienta en Tool Registry
    const tool = this.registry.getTool(approval.tool_id);
    if (!tool || tool.status === "disabled") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_DISABLED, message: "Herramienta deshabilitada.", statusCode: 403 });
    }

    // Transición atómica en memoria
    if (decision === "reject") {
      approval.status = "rejected";
      approval.approver_id = approverId;
      approval.resolved_at = new Date().toISOString();
      approval.comment = comment || null;
      return { valid: true };
    }

    // Aprobado: APPROVED NO ES COMPLETED. Marca approved y devuelve datos de lease
    approval.status = "approved";
    approval.approver_id = approverId;
    approval.resolved_at = new Date().toISOString();
    approval.comment = comment || null;

    return {
      valid: true,
      stepId: approval.step_id,
      fencingToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  }
}

export const defaultApprovalGovernance = new ApprovalGovernance();
