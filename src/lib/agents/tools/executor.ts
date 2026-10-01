/**
 * NEXTEХ Agent Core — Tool Executor en Sandbox Seguro (Fase 4.2)
 * Ejecución controlada con timeouts, validación de parámetros, sanitización y captura canónica.
 */

import { ToolExecutionContext, ToolDefinition } from "./types";
import { defaultToolRegistry, ToolRegistry } from "./registry";
import { AgentError, AgentErrorCodes } from "../types/errors";
import { sanitizeText } from "@/lib/omniengine/security/sanitizer";

export interface ToolExecutionResult {
  toolId: string;
  result: any;
  metadata?: Record<string, any>;
  durationMs: number;
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry = defaultToolRegistry) {}

  /**
   * Ejecuta una herramienta dentro de un sandbox seguro con timeout y sanitización.
   */
  public async execute(
    toolId: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const tool = this.registry.getTool(toolId);

    if (!tool) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_FOUND,
        message: `Herramienta '${toolId}' no encontrada en el ToolRegistry.`,
        statusCode: 404,
        toolId,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    if (!tool.enabled) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_NOT_ALLOWED,
        message: `La herramienta '${tool.name}' está deshabilitada en la plataforma.`,
        statusCode: 403,
        toolId,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    if (!tool.handler) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
        message: `La herramienta '${tool.name}' no posee un ejecutor (handler) implementado.`,
        statusCode: 501,
        toolId,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    // 1. Validar parámetros obligatorios
    this.validateParameters(tool, params);

    // 2. Control de Timeout por herramienta
    const timeoutMs = tool.timeoutMs || 5000;
    const timeoutController = new AbortController();

    // Si ya viene una señal externa de cancelación del agente
    if (context.signal?.aborted) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_CANCELLED,
        message: "Ejecución de la herramienta abortada antes de iniciar.",
        statusCode: 499,
        toolId,
        runId: context.runId,
        agentId: context.agentId,
      });
    }

    const timer = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      // Ejecución con timeout
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
              toolId,
              runId: context.runId,
              agentId: context.agentId,
            })
          );
        });
      });

      const outcome = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      // 3. Sanitizar resultado para evitar fuga de tokens o secretos
      const sanitizedResult = this.sanitizeOutput(outcome.result);

      return {
        toolId,
        result: sanitizedResult,
        metadata: {
          ...outcome.metadata,
          durationMs: Date.now() - startTime,
          riskLevel: tool.riskLevel,
        },
        durationMs: Date.now() - startTime,
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
        toolId,
        runId: context.runId,
        agentId: context.agentId,
      });
    }
  }

  private validateParameters(tool: ToolDefinition, params: Record<string, any>) {
    if (!tool.parameters) return;

    for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
      if (paramDef.required && (params[paramName] === undefined || params[paramName] === null || params[paramName] === "")) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
          message: `El parámetro '${paramName}' es requerido para la herramienta '${tool.name}'.`,
          statusCode: 400,
          toolId: tool.id,
        });
      }
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
