/**
 * NEXTEХ Agent Core — Tool Executor en Sandbox Seguro (Fase 4.3)
 * Ejecución controlada con validación estricta de esquemas, timeouts, sanitización y normalización de salida.
 */

import { ToolExecutionContext, ToolDefinition, NormalizedToolOutput } from "./types";
import { defaultToolRegistry, ToolRegistry } from "./registry";
import { SchemaValidator } from "./validator";
import { AgentError, AgentErrorCodes } from "../types/errors";
import { sanitizeText } from "@/lib/omniengine/security/sanitizer";

export class ToolExecutor {
  constructor(private registry: ToolRegistry = defaultToolRegistry) {}

  /**
   * Ejecuta una herramienta dentro del sandbox seguro.
   * La herramienta ya debe haber pasado por PermissionEngine.
   */
  public async execute(
    toolIdentifier: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<NormalizedToolOutput> {
    const startTime = Date.now();
    const tool = this.registry.getTool(toolIdentifier);

    if (!tool) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_FOUND,
        message: `Herramienta '${toolIdentifier}' no encontrada en el ToolRegistry.`,
        statusCode: 404,
        toolId: toolIdentifier,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    if (tool.status === "disabled") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_DISABLED,
        message: `La herramienta '${tool.name}' está deshabilitada en la plataforma.`,
        statusCode: 403,
        toolId: tool.id,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    if (tool.status === "draft") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `La herramienta '${tool.name}' está en estado 'draft' y no es ejecutable.`,
        statusCode: 403,
        toolId: tool.id,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    if (!tool.handler) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
        message: `La herramienta '${tool.name}' no posee un ejecutor implementado.`,
        statusCode: 501,
        toolId: tool.id,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    // 1. VALIDACIÓN ESTRICTA DE ESQUEMA DE ENTRADA (SchemaValidator)
    SchemaValidator.validate(tool, params);

    // 2. Control de Timeout por herramienta
    const timeoutMs = tool.timeoutMs || 5000;
    const timeoutController = new AbortController();

    if (context.signal?.aborted) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_CANCELLED,
        message: "Ejecución de la herramienta cancelada antes de iniciar.",
        statusCode: 499,
        toolId: tool.id,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    const timer = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      const executionPromise = tool.handler(params, {
        ...context,
        signal: timeoutController.signal,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutController.signal.addEventListener("abort", () => {
          reject(
            new AgentError({
              code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
              message: `Timeout en herramienta '${tool.name}': excedió el límite de ${timeoutMs}ms.`,
              statusCode: 504,
              toolId: tool.id,
              runId: context.runId,
              agentId: context.agentId,
            })
          );
        });
      });

      const outcome = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      // 3. Sanitizar resultado para evitar fuga de tokens o secretos
      const sanitizedData = this.sanitizeOutput(outcome.result);

      // 4. Normalizar la salida con NormalizedToolOutput
      return {
        success: true,
        data: sanitizedData,
        metadata: {
          toolId: tool.id,
          version: tool.version,
          durationMs: Date.now() - startTime,
          riskLevel: tool.riskLevel,
          category: tool.category,
          ...outcome.metadata,
        },
      };
    } catch (err: any) {
      clearTimeout(timer);

      if (err instanceof AgentError) {
        throw err;
      }

      throw new AgentError({
        code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
        message: `Error al ejecutar herramienta '${tool.name}': ${err?.message || "Fallo inesperado"}`,
        statusCode: 500,
        toolId: tool.id,
        runId: context.runId,
        agentId: context.agentId,
      });
    }
  }

  private sanitizeOutput(data: any): any {
    if (typeof data === "string") {
      return sanitizeText(data);
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeOutput(item));
    }
    if (typeof data === "object" && data !== null) {
      const sanitizedObj: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        sanitizedObj[key] = this.sanitizeOutput(value);
      }
      return sanitizedObj;
    }
    return data;
  }
}

export const defaultToolExecutor = new ToolExecutor();
