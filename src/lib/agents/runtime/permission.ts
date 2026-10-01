/**
 * NEXTEХ Agent Core — Permission Engine
 * Validador estricto de autorizaciones de herramientas antes de cualquier invocación.
 * PRINCIPIO: El LLM propone una acción; la plataforma decide si está permitida.
 */

import { defaultToolRegistry, ToolRegistry } from "../tools/registry";
import { ToolDefinition } from "../tools/types";
import { AgentError, AgentErrorCodes } from "../types/errors";

export class PermissionEngine {
  private registry: ToolRegistry;

  constructor(registry = defaultToolRegistry) {
    this.registry = registry;
  }

  /**
   * Comprueba si un agente tiene permitido invocar una herramienta específica.
   */
  public validateToolAccess(
    toolId: string,
    authorizedToolsForAgent: string[]
  ): ToolDefinition {
    // 1. ¿Existe la herramienta en el Tool Registry del sistema?
    const tool = this.registry.getTool(toolId);
    if (!tool) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_FOUND,
        message: `La herramienta '${toolId}' no existe en el registro del sistema.`,
        statusCode: 404,
        toolId,
      });
    }

    // 2. ¿Está habilitada en la plataforma?
    if (!tool.enabled) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `La herramienta '${tool.name}' (${toolId}) está deshabilitada en esta fase del sistema.`,
        statusCode: 403,
        toolId,
      });
    }

    // 3. ¿El agente tiene asignada explícitamente esta herramienta?
    if (!authorizedToolsForAgent.includes(toolId)) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `El agente no tiene autorización para ejecutar la herramienta '${tool.name}' (${toolId}).`,
        statusCode: 403,
        toolId,
      });
    }

    return tool;
  }
}

export const defaultPermissionEngine = new PermissionEngine();
