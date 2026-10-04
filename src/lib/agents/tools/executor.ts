/**
 * NEXTEХ Agent Core — Tool Executor en Sandbox Seguro (Fase 4.3 & 4.9.1)
 * Ejecución controlada con validación estricta de esquemas, timeouts, sanitización,
 * pre-tool barrier para cercado (fencing) distribuido y soporte de idempotency keys.
 */

import { ToolExecutionContext, ToolDefinition, NormalizedToolOutput } from "./types";
import { defaultToolRegistry, ToolRegistry } from "./registry";
import { SchemaValidator } from "./validator";
import { AgentError, AgentErrorCodes } from "../types/errors";
import { sanitizeText } from "@/lib/omniengine/security/sanitizer";

export class ToolExecutor {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry = defaultToolRegistry) {
    this.registry = registry;
  }

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

    // 2. PRE-TOOL EXECUTION BARRIER (Fase 4.9.1 Hardening)
    // Valida que el JobRun siga activo, no terminal, con lease vigente y fencing coincidente
    // ANTES de iniciar cualquier mutación o efecto secundario en el mundo exterior.
    await this.validatePreExecutionBarrier(tool, context);

    // 3. Control de Timeout por herramienta
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

    // 4. Clave de Idempotencia Canónica Estable (Fase 4.9.1-R2)
    // Representa la identidad lógica de UNA operación:
    // workspace_id + job_run_id + agent_run_id + step_id + tool_id
    // NO incluye fencingToken ni workerId, garantizando que tras recovery
    // un worker diferente con fencing diferente genere exactamente la MISMA clave.
    const isExternalSideEffect = tool.riskLevel === "external" || tool.riskLevel === "destructive";
    const idempotencyKey =
      context.idempotencyKey ||
      (isExternalSideEffect
        ? `idemp_${context.workspaceId}_${context.jobRunId || "direct"}_${context.runId}_${context.stepId || "step"}_${tool.id}`
        : undefined);

    const enrichedContext: ToolExecutionContext = {
      ...context,
      idempotencyKey,
      signal: timeoutController.signal,
    };

    try {
      const executionPromise = tool.handler(params, enrichedContext);

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

      // 5. Sanitizar resultado para evitar fuga de tokens o secretos
      const sanitizedData = this.sanitizeOutput(outcome.result);

      // 6. Normalizar la salida con NormalizedToolOutput
      return {
        success: true,
        data: sanitizedData,
        metadata: {
          toolId: tool.id,
          version: tool.version,
          durationMs: Date.now() - startTime,
          riskLevel: tool.riskLevel,
          category: tool.category,
          idempotencyKey,
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

  /**
   * Pre-Tool Execution Barrier (Fase 4.9.1)
   * Valida en base de datos la autoridad del worker antes de ejecutar cualquier herramienta.
   */
  private async validatePreExecutionBarrier(
    tool: ToolDefinition,
    context: ToolExecutionContext
  ): Promise<void> {
    if (!context.jobRunId || !context.supabaseClient) {
      return;
    }

    const { data: jobRun, error: jrErr } = await (context.supabaseClient
      .from("job_runs") as any)
      .select("id, workspace_id, agent_id, worker_id, fencing_token, status, lease_expires_at")
      .eq("id", context.jobRunId)
      .maybeSingle();

    if (jrErr || !jobRun) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_FENCING_REJECTED,
        message: `PRE-TOOL BARRIER: JobRun '${context.jobRunId}' no encontrado en base de datos.`,
        statusCode: 409,
        toolId: tool.id,
        runId: context.runId,
      });
    }

    // A. Aislamiento Multi-Tenant Estricto
    if (jobRun.workspace_id !== context.workspaceId) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
        message: `PRE-TOOL BARRIER: Violación cross-tenant detectada (JobRun ws: ${jobRun.workspace_id} vs context ws: ${context.workspaceId}).`,
        statusCode: 403,
        toolId: tool.id,
        runId: context.runId,
      });
    }

    // B. Estado ejecutable obligatorio (running o claimed únicamente)
    if (jobRun.status !== "running" && jobRun.status !== "claimed") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_FENCING_REJECTED,
        message: `PRE-TOOL BARRIER: JobRun no se encuentra en estado ejecutable ('${jobRun.status}'). Ejecución de herramienta cancelada.`,
        statusCode: 409,
        toolId: tool.id,
        runId: context.runId,
      });
    }

    // B2. Verificación de Agente Activo y Pertenencia a Tenant
    if (jobRun.agent_id) {
      const { data: agentRec } = await (context.supabaseClient
        .from("agents") as any)
        .select("id, status, workspace_id")
        .eq("id", jobRun.agent_id)
        .maybeSingle();

      if (agentRec && (agentRec.status !== "active" || agentRec.workspace_id !== context.workspaceId)) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_NOT_ACTIVE,
          message: `PRE-TOOL BARRIER: El Agente '${jobRun.agent_id}' no está activo (${agentRec?.status}) o no pertenece al workspace.`,
          statusCode: 400,
          toolId: tool.id,
          runId: context.runId,
        });
      }
    }

    // C. Cercado estricto por Worker ID
    if (context.workerId && jobRun.worker_id && jobRun.worker_id !== context.workerId) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_FENCING_REJECTED,
        message: `PRE-TOOL BARRIER: Worker '${context.workerId}' ya no posee el lease del JobRun (poseído por '${jobRun.worker_id}').`,
        statusCode: 409,
        toolId: tool.id,
        runId: context.runId,
      });
    }

    // D. Fencing Token Monótono
    if (context.fencingToken !== undefined && Number(jobRun.fencing_token) !== Number(context.fencingToken)) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_FENCING_REJECTED,
        message: `PRE-TOOL BARRIER: Fencing token desfasado (contexto: ${context.fencingToken}, DB: ${jobRun.fencing_token}). El worker fue cercado fuera.`,
        statusCode: 409,
        toolId: tool.id,
        runId: context.runId,
      });
    }

    // E. Validez temporal de Lease
    if (jobRun.lease_expires_at) {
      const expiresMs = new Date(jobRun.lease_expires_at).getTime();
      if (expiresMs <= Date.now()) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_LEASE_EXPIRED,
          message: `PRE-TOOL BARRIER: El lease del JobRun expiró en ${jobRun.lease_expires_at}.`,
          statusCode: 409,
          toolId: tool.id,
          runId: context.runId,
        });
      }
    }

    // F. Integridad de Linaje: AgentRun pertenece al JobRun
    if (context.runId) {
      const { data: agentRunRec } = await (context.supabaseClient
        .from("agent_runs") as any)
        .select("id, job_run_id, workspace_id")
        .eq("id", context.runId)
        .maybeSingle();

      if (agentRunRec && (agentRunRec.job_run_id !== context.jobRunId || agentRunRec.workspace_id !== context.workspaceId)) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
          message: `PRE-TOOL BARRIER: El AgentRun no pertenece al JobRun ni al workspace indicado.`,
          statusCode: 403,
          toolId: tool.id,
          runId: context.runId,
        });
      }
    }

    // G. Integridad de Linaje: Step pertenece al AgentRun
    if (context.stepId && context.runId) {
      const { data: stepRec } = await (context.supabaseClient
        .from("agent_run_steps") as any)
        .select("id, run_id, workspace_id")
        .eq("id", context.stepId)
        .maybeSingle();

      if (stepRec && (stepRec.run_id !== context.runId || stepRec.workspace_id !== context.workspaceId)) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
          message: `PRE-TOOL BARRIER: El Step no pertenece al AgentRun ni al workspace indicado.`,
          statusCode: 403,
          toolId: tool.id,
          runId: context.runId,
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
