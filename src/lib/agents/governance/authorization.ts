/**
 * NEXTEХ Agent Core — Authorization Engine (Fase 4.4)
 * ÚNICA AUTORIDAD CENTRAL de decisión de autorización en la plataforma.
 * Coordina PermissionEngine, PolicyEngine y ToolRegistry.
 * Emite exclusivamente: 'allow' | 'deny' | 'approval_required'
 */

import { defaultPermissionEngine, PermissionEngine } from "./permissions";
import { defaultPolicyEngine, PolicyEngine } from "./policies";
import { defaultToolRegistry, ToolRegistry } from "../tools/registry";
import {
  Agent,
  AgentPolicy,
  AuthorizationDecision,
  AuthorizationEvaluationContext,
  CanonicalPermissionKey,
  ToolRiskLevel,
  WorkspaceRole,
} from "../types";

export class AuthorizationEngine {
  constructor(
    private permissions: PermissionEngine = defaultPermissionEngine,
    private policies: PolicyEngine = defaultPolicyEngine,
    private registry: ToolRegistry = defaultToolRegistry
  ) {}

  /**
   * Evalúa de forma centralizada si una acción concreta puede ejecutarse.
   * NINGUNA OTRA CAPA (UI, API, Runtime) debe implementar lógica paralela.
   */
  public async evaluate(
    context: AuthorizationEvaluationContext,
    options?: {
      agent?: Agent;
      policy?: AgentPolicy;
      supabaseClient?: any;
      inMemoryRole?: WorkspaceRole;
      inMemoryOverrides?: Map<string, "allow" | "deny">;
    }
  ): Promise<AuthorizationDecision> {
    const { userId, workspaceId, agentId, toolId, toolVersion } = context;

    if (!userId || !workspaceId || !agentId) {
      return {
        decision: "deny",
        reason: "Contexto de autorización inválido o incompleto.",
        selfApprovalAllowed: false,
      };
    }

    // 1. OBTENER Y VALIDAR POLÍTICA DEL AGENTE
    const agent = options?.agent || {
      id: agentId,
      workspace_id: workspaceId,
      name: "Agente Evaluado",
      description: null,
      system_instructions: "",
      model_id: "gpt-4o",
      status: "active",
      max_steps: 10,
      max_tokens: 8000,
      timeout_seconds: 60,
      max_tool_calls: 5,
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const policy = options?.policy || this.policies.getDefaultPolicy(agentId, workspaceId);

    // 2. VALIDAR PERMISOS DEL USUARIO: 'runs.execute'
    const canRun = await this.permissions.can(userId, workspaceId, "runs.execute", {
      supabaseClient: options?.supabaseClient,
      inMemoryOverrides: options?.inMemoryOverrides,
      inMemoryRole: options?.inMemoryRole,
    });

    if (!canRun.allowed) {
      return {
        decision: "deny",
        reason: `El usuario carece de permiso para ejecutar agentes en este workspace ('runs.execute'). ${canRun.reason}`,
        requiredPermission: "runs.execute",
        selfApprovalAllowed: false,
      };
    }

    // 3. SI NO HAY LLAMADA A HERRAMIENTA (Inferencia de texto pura)
    if (!toolId) {
      const policyEval = this.policies.evaluateAgentPolicy(agent, policy);
      if (!policyEval.allowExecution) {
        return {
          decision: "deny",
          reason: policyEval.reason,
          selfApprovalAllowed: false,
        };
      }
      return {
        decision: "allow",
        reason: "Inferencia autorizada sin llamada a herramientas.",
        selfApprovalAllowed: false,
      };
    }

    // 4. VALIDAR HERRAMIENTA EN TOOL REGISTRY
    const toolIdentifier = toolVersion ? `${toolId}@${toolVersion}` : toolId;
    const tool = this.registry.getTool(toolIdentifier) || this.registry.getTool(toolId);

    if (!tool) {
      return {
        decision: "deny",
        reason: `La herramienta '${toolIdentifier}' no existe en el registro del sistema.`,
        selfApprovalAllowed: false,
      };
    }

    if (tool.status === "disabled") {
      return {
        decision: "deny",
        reason: `La herramienta '${tool.name}' está deshabilitada en la plataforma.`,
        selfApprovalAllowed: false,
      };
    }

    if (tool.status === "draft") {
      return {
        decision: "deny",
        reason: `La herramienta '${tool.name}' está en estado 'draft' y no es ejecutable.`,
        selfApprovalAllowed: false,
      };
    }

    const riskLevel: ToolRiskLevel = tool.riskLevel;
    const requiredRiskPerm = `tools.execute_${riskLevel}` as CanonicalPermissionKey;

    // 5. EVALUAR POLÍTICA DEL AGENTE FRENTE AL RIESGO
    const policyEval = this.policies.evaluateAgentPolicy(agent, policy, riskLevel);
    if (!policyEval.allowExecution) {
      return {
        decision: "deny",
        reason: policyEval.reason,
        riskLevel,
        selfApprovalAllowed: policyEval.selfApprovalAllowed,
      };
    }

    // 6. VALIDAR PERMISO DEL USUARIO PARA EL RIESGO DE LA HERRAMIENTA
    const canExecuteRisk = await this.permissions.can(userId, workspaceId, requiredRiskPerm, {
      supabaseClient: options?.supabaseClient,
      inMemoryOverrides: options?.inMemoryOverrides,
      inMemoryRole: options?.inMemoryRole,
    });

    if (!canExecuteRisk.allowed) {
      return {
        decision: "deny",
        reason: `El usuario no tiene el permiso necesario '${requiredRiskPerm}' para ejecutar herramientas de riesgo '${riskLevel}'. ${canExecuteRisk.reason}`,
        requiredPermission: requiredRiskPerm,
        riskLevel,
        selfApprovalAllowed: policyEval.selfApprovalAllowed,
      };
    }

    // 7. DETERMINAR SI REQUIERE APROBACIÓN HUMANA (HITL)
    if (policyEval.approvalRequired || tool.requiresApproval || riskLevel === "destructive") {
      return {
        decision: "approval_required",
        reason: policyEval.reason,
        requiredPermission: requiredRiskPerm,
        riskLevel,
        selfApprovalAllowed: policyEval.selfApprovalAllowed,
        metadata: {
          toolId: tool.id,
          toolVersion: tool.version,
          category: tool.category,
        },
      };
    }

    // 8. AUTORIZADO (ALLOW)
    return {
      decision: "allow",
      reason: `Ejecución autorizada para la herramienta '${tool.name}' (Riesgo: ${riskLevel.toUpperCase()}).`,
      requiredPermission: requiredRiskPerm,
      riskLevel,
      selfApprovalAllowed: policyEval.selfApprovalAllowed,
      metadata: {
        toolId: tool.id,
        toolVersion: tool.version,
      },
    };
  }
}

export const defaultAuthorizationEngine = new AuthorizationEngine();
