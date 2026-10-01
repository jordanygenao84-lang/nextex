/**
 * NEXTEХ Agent Core — Permission Engine (Fase 4.4)
 * Validador estricto de autorizaciones, ciclo de vida, compatibilidad de versiones y permisos RBAC.
 * PRINCIPIO: El LLM propone una acción; la plataforma decide si está permitida.
 */

import { defaultToolRegistry, ToolRegistry } from "../tools/registry";
import { ToolDefinition } from "../tools/types";
import { AgentError, AgentErrorCodes } from "../types/errors";
import { CanonicalPermissionKey, WorkspaceRole } from "../types";
import { defaultPermissionEngine as govPermissionEngine } from "../governance/permissions";

export class PermissionEngine {
  private registry: ToolRegistry;

  constructor(registry = defaultToolRegistry) {
    this.registry = registry;
  }

  /**
   * Comprueba si un usuario posee un permiso canónico en un workspace.
   */
  public async can(
    userId: string,
    workspaceId: string,
    permissionKey: CanonicalPermissionKey,
    context?: {
      supabaseClient?: any;
      inMemoryOverrides?: Map<string, "allow" | "deny">;
      inMemoryRole?: WorkspaceRole;
    }
  ) {
    return govPermissionEngine.can(userId, workspaceId, permissionKey, context);
  }

  /**
   * Comprueba si un agente tiene permitido invocar una herramienta específica y versión.
   */
  public validateToolAccess(
    toolIdentifier: string,
    authorizedToolsForAgent: string[]
  ): ToolDefinition {
    if (!toolIdentifier || typeof toolIdentifier !== "string") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_FOUND,
        message: "Identificador de herramienta no especificado o inválido.",
        statusCode: 400,
      });
    }

    const baseId = toolIdentifier.split("@")[0].toLowerCase().trim();
    const requestedVersion = toolIdentifier.split("@")[1];

    // 1. ¿Existe la herramienta base en el Tool Registry del sistema?
    const defaultTool = this.registry.getTool(baseId);
    if (!defaultTool) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_FOUND,
        message: `La herramienta '${baseId}' no existe en el Tool Registry del sistema.`,
        statusCode: 404,
        toolId: baseId,
      });
    }

    // 2. Si se solicitó una versión específica, validar soporte
    const tool = this.registry.getTool(toolIdentifier);
    if (!tool && requestedVersion) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_VERSION_UNSUPPORTED,
        message: `La versión '${requestedVersion}' para la herramienta '${baseId}' no es soportada.`,
        statusCode: 400,
        toolId: baseId,
      });
    }

    const resolvedTool = tool || defaultTool;

    // 3. ¿Cuál es su estado en el ciclo de vida (Lifecycle)?
    if (resolvedTool.status === "disabled") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_DISABLED,
        message: `La herramienta '${resolvedTool.name}' (${resolvedTool.id}) está actualmente deshabilitada en la plataforma.`,
        statusCode: 403,
        toolId: resolvedTool.id,
      });
    }

    if (resolvedTool.status === "draft") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `La herramienta '${resolvedTool.name}' se encuentra en estado 'draft' y no puede ser ejecutada.`,
        statusCode: 403,
        toolId: resolvedTool.id,
      });
    }

    // 4. ¿El agente tiene asignada explícitamente esta herramienta?
    const isAssigned =
      authorizedToolsForAgent.includes(baseId) ||
      authorizedToolsForAgent.includes(resolvedTool.id) ||
      authorizedToolsForAgent.includes(`${baseId}@${resolvedTool.version}`);

    if (!isAssigned) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `El agente no tiene autorización para ejecutar la herramienta '${resolvedTool.name}' (${baseId}).`,
        statusCode: 403,
        toolId: resolvedTool.id,
      });
    }

    return resolvedTool;
  }
}

export const defaultPermissionEngine = new PermissionEngine();
