/**
 * NEXTEХ Agent Core — Policy Engine (Fase 4.4)
 * Motor de políticas declarativas por agente: riesgos tolerados, modos de aprobación,
 * mitigación de self-approval y límites de concurrencia.
 */

import { Agent, AgentPolicy, ToolRiskLevel } from "../types";
import { AgentError, AgentErrorCodes } from "../types/errors";

export interface PolicyEvaluationResult {
  allowExecution: boolean;
  approvalRequired: boolean;
  selfApprovalAllowed: boolean;
  reason: string;
}

export class PolicyEngine {
  /**
   * Obtiene la política por defecto para un agente en caso de no existir registro persistido.
   */
  public getDefaultPolicy(agentId: string, workspaceId: string): AgentPolicy {
    return {
      id: `policy-default-${agentId}`,
      agent_id: agentId,
      workspace_id: workspaceId,
      allow_execution: true,
      allowed_tool_risks: ["read", "write", "external"],
      approval_mode: "required",
      self_approval_mode: "blocked",
      max_concurrent_runs: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Evalúa la política de un agente frente a una herramienta y nivel de riesgo.
   */
  public evaluateAgentPolicy(
    agent: Agent,
    policy: AgentPolicy,
    riskLevel?: ToolRiskLevel
  ): PolicyEvaluationResult {
    // 1. Validar si la ejecución del agente está permitida globalmente
    if (!policy.allow_execution || agent.status !== "active") {
      return {
        allowExecution: false,
        approvalRequired: false,
        selfApprovalAllowed: false,
        reason: `La política del agente prohíbe su ejecución (allow_execution: ${policy.allow_execution}, status: '${agent.status}').`,
      };
    }

    // 2. Si no hay riesgo (ej. solo inferencia de texto), permitir
    if (!riskLevel) {
      return {
        allowExecution: true,
        approvalRequired: false,
        selfApprovalAllowed: false,
        reason: "Inferencia pura sin invocación de herramientas.",
      };
    }

    // 3. Validar si el nivel de riesgo está tolerado por el agente
    if (!policy.allowed_tool_risks.includes(riskLevel)) {
      return {
        allowExecution: false,
        approvalRequired: false,
        selfApprovalAllowed: false,
        reason: `Riesgo '${riskLevel.toUpperCase()}' no permitido por la política del agente. Riesgos tolerados: [${policy.allowed_tool_risks.join(", ")}].`,
      };
    }

    // 4. Determinar si se requiere aprobación humana según el modo de aprobación
    // A) Riesgo Destructive: Aprobación siempre obligatoria e inmutable
    if (riskLevel === "destructive") {
      return {
        allowExecution: true,
        approvalRequired: true,
        selfApprovalAllowed: policy.self_approval_mode === "allowed",
        reason: "Las herramientas con nivel de riesgo 'destructive' exigen aprobación humana obligatoria.",
      };
    }

    // B) Riesgo Read: Ejecución automática permitida si approval_mode lo autoriza
    if (riskLevel === "read") {
      if (policy.approval_mode === "automatic") {
        return {
          allowExecution: true,
          approvalRequired: false,
          selfApprovalAllowed: false,
          reason: "Lectura con aprobación automática habilitada.",
        };
      }
      // Si approval_mode es 'required', se pide aprobación incluso para lectura
      return {
        allowExecution: true,
        approvalRequired: policy.approval_mode === "required",
        selfApprovalAllowed: policy.self_approval_mode === "allowed",
        reason: policy.approval_mode === "required"
          ? "Política de agente exige aprobación estricta para toda herramienta."
          : "Lectura autorizada.",
      };
    }

    // C) Riesgos Write y External:
    // CORRECCIÓN 3: Si approval_mode == 'conditional', FALLA SEGURO hacia 'required' (RESERVADO / NO BYPASS)
    if (policy.approval_mode === "conditional") {
      return {
        allowExecution: true,
        approvalRequired: true, // FAIL-SAFE DEFAULT
        selfApprovalAllowed: policy.self_approval_mode === "allowed",
        reason: "Modo de aprobación 'conditional' reservado: exige aprobación humana de forma preventiva (Fail-Safe).",
      };
    }

    if (policy.approval_mode === "required") {
      return {
        allowExecution: true,
        approvalRequired: true,
        selfApprovalAllowed: policy.self_approval_mode === "allowed",
        reason: `Herramienta de riesgo '${riskLevel.toUpperCase()}' exige aprobación humana (HITL).`,
      };
    }

    // Si approval_mode == 'automatic' para write/external: NO SE PERMITE bypass
    return {
      allowExecution: true,
      approvalRequired: true,
      selfApprovalAllowed: policy.self_approval_mode === "allowed",
      reason: `Herramienta mutativa o externa ('${riskLevel}') exige aprobación humana obligatoria en NEXTEХ.`,
    };
  }

  /**
   * Evalúa si un nuevo run puede crearse respetando el límite de concurrencia.
   */
  public evaluateConcurrency(
    activeRunsCount: number,
    policy: AgentPolicy
  ): { allowed: boolean; reason?: string } {
    const limit = policy.max_concurrent_runs || 3;
    if (activeRunsCount >= limit) {
      return {
        allowed: false,
        reason: `Límite de concurrencia alcanzado: el agente tiene ${activeRunsCount} runs activos de un máximo permitido de ${limit}.`,
      };
    }
    return { allowed: true };
  }
}

export const defaultPolicyEngine = new PolicyEngine();
