/**
 * NEXTEХ Agent Core — Authorization Engine (Fase 4.4 & 4.5)
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
  MemoryScope,
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

  /**
   * Evalúa de forma centralizada operaciones sobre el subsistema de Memoria Cognitiva (Fase 4.5).
   * Aplica reglas de jerarquía de roles (Member no puede crear scope=workspace) y prohibición de trust_level=system.
   */
  public async evaluateMemoryAccess(
    context: AuthorizationEvaluationContext,
    action: "read" | "write" | "delete" | "manage",
    options?: {
      agent?: Agent;
      targetScope?: MemoryScope;
      targetTrustLevel?: string;
      policy?: AgentPolicy;
      supabaseClient?: any;
      inMemoryRole?: WorkspaceRole;
      inMemoryOverrides?: Map<string, "allow" | "deny">;
    }
  ): Promise<AuthorizationDecision> {
    const { userId, workspaceId, agentId } = context;

    if (!userId || !workspaceId) {
      return {
        decision: "deny",
        reason: "Contexto de autorización incompleto para operaciones de memoria.",
        selfApprovalAllowed: false,
      };
    }

    // Validar que el agente pertenezca al workspace solicitado si se proporciona
    if (options?.agent && options.agent.workspace_id !== workspaceId) {
      return {
        decision: "deny",
        reason: "El agente no pertenece al workspace solicitado (bloqueo cross-tenant).",
        selfApprovalAllowed: false,
      };
    }

    const requiredPerm = `memory.${action}` as CanonicalPermissionKey;

    // 1. Validar permiso correspondiente
    const canAction = await this.permissions.can(userId, workspaceId, requiredPerm, {
      supabaseClient: options?.supabaseClient,
      inMemoryOverrides: options?.inMemoryOverrides,
      inMemoryRole: options?.inMemoryRole,
    });

    if (!canAction.allowed) {
      return {
        decision: "deny",
        reason: `Usuario carece de permiso '${requiredPerm}' en este workspace. ${canAction.reason}`,
        requiredPermission: requiredPerm,
        selfApprovalAllowed: false,
      };
    }

    // 2. Comprobar restricción de trust_level = system (Ningún cliente o API puede asignar system)
    if (options?.targetTrustLevel === "system") {
      return {
        decision: "deny",
        reason: "Prohibición de seguridad: Ninguna API ni usuario puede asignar trust_level='system'.",
        selfApprovalAllowed: false,
      };
    }

    // 3. Comprobar restricción de scope para miembros (Member no puede crear scope='workspace')
    const userRole = options?.inMemoryRole || "member";
    if (userRole === "member" && action === "write" && options?.targetScope === "workspace") {
      return {
        decision: "deny",
        reason: "Jerarquía administrativa: Los usuarios con rol 'member' no pueden crear memorias con scope 'workspace'.",
        selfApprovalAllowed: false,
      };
    }

    // 4. Validar política del agente si aplica
    if (options?.policy) {
      if (options.policy.memory_enabled === false) {
        return {
          decision: "deny",
          reason: "La memoria está deshabilitada en la política de este agente.",
          selfApprovalAllowed: false,
        };
      }

      if (action === "write" && options.policy.memory_write_mode === "disabled") {
        return {
          decision: "deny",
          reason: "La escritura de memoria está deshabilitada en la política de este agente.",
          selfApprovalAllowed: false,
        };
      }
    }

    return {
      decision: "allow",
      reason: `Operación 'memory.${action}' autorizada.`,
      requiredPermission: requiredPerm,
      selfApprovalAllowed: false,
    };
  }
}

export const defaultAuthorizationEngine = new AuthorizationEngine();
