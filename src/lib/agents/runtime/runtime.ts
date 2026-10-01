/**
 * NEXTEХ Agent Core — Agent Runtime (Fase 4.2)
 * Orquestador central de ejecución segura de agentes autónomos.
 * Integra Tool Execution Engine, Sandboxing y Aprobación Humana (Human-in-the-Loop).
 */

import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { defaultQuotaManager } from "@/lib/omniengine/quotas/quota-manager";
import { defaultPermissionEngine } from "./permission";
import { defaultToolRegistry } from "../tools/registry";
import { defaultToolExecutor } from "../tools/executor";
import {
  Agent,
  AgentRun,
  AgentRunStep,
  ExecuteAgentRunDTO,
} from "../types";
import { AgentError, AgentErrorCodes } from "../types/errors";

export interface ExecutionResult {
  run: AgentRun;
  steps: AgentRunStep[];
  needsApproval?: boolean;
  approvalStep?: AgentRunStep;
}

export class AgentRuntime {
  /**
   * Ejecuta un Agent Run con gobernanza de límites, RLS, OmniEngine y Tool Execution.
   */
  public async executeRun(
    agent: Agent,
    dto: ExecuteAgentRunDTO,
    supabase?: any,
    externalSignal?: AbortSignal
  ): Promise<ExecutionResult> {
    // 1. Validar autenticación
    if (!dto.user_id?.trim()) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
        message: "Se requiere un usuario autenticado para ejecutar un agente.",
        statusCode: 401,
      });
    }

    // 2. Validar que el agente pertenezca al workspace de la petición
    if (agent.workspace_id !== dto.workspace_id) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
        message: "El agente no pertenece al workspace solicitado.",
        statusCode: 403,
        agentId: agent.id,
      });
    }

    // 3. Validar estado ejecutable del agente
    if (agent.status !== "active") {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_ACTIVE,
        message: `El agente está en estado '${agent.status}'. Solo los agentes en estado 'active' pueden ejecutarse.`,
        statusCode: 400,
        agentId: agent.id,
      });
    }

    // 4. Validar autorización de membresía en el workspace si hay cliente Supabase
    let userPlan: "free" | "pro" | "enterprise" = "free";
    if (supabase) {
      const { data: member, error: memberErr } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", dto.workspace_id)
        .eq("user_id", dto.user_id)
        .maybeSingle();

      if (memberErr || !member) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
          message: "No tienes autorización para ejecutar agentes en este workspace.",
          statusCode: 403,
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", dto.user_id)
        .single();

      userPlan = (profile?.plan as any) || "free";
    }

    // 5. Jerarquía de límites: el límite más restrictivo siempre prevalece
    const quotaPolicy = defaultQuotaManager.getPolicy(userPlan);
    const effectiveMaxTokens = Math.min(
      quotaPolicy.maxTokensPerRequest,
      agent.max_tokens,
      dto.override_max_tokens || agent.max_tokens
    );
    const effectiveTimeoutSec = Math.min(
      agent.timeout_seconds,
      dto.override_timeout_seconds || agent.timeout_seconds
    );
    const effectiveMaxSteps = Math.min(
      agent.max_steps,
      dto.override_max_steps || agent.max_steps
    );

    // 6. Preparar Timeout y Cancelación
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error("AGENT_TIMEOUT"));
    }, effectiveTimeoutSec * 1000);

    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        abortController.abort(new Error("AGENT_CANCELLED"));
      });
    }

    // 7. Instanciar Run en memoria
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const run: AgentRun = {
      id: runId,
      workspace_id: dto.workspace_id,
      agent_id: agent.id,
      user_id: dto.user_id,
      status: "running",
      input: dto.input,
      output: null,
      model_id: agent.model_id,
      tokens_input: 0,
      tokens_output: 0,
      total_tokens: 0,
      steps_count: 0,
      tool_calls_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_code: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const steps: AgentRunStep[] = [];

    // Persistir run inicial si hay base de datos
    if (supabase) {
      try {
        await (supabase.from("agent_runs") as any).insert({
          id: run.id,
          workspace_id: run.workspace_id,
          agent_id: run.agent_id,
          user_id: run.user_id,
          status: run.status,
          input: run.input,
          model_id: run.model_id,
          started_at: run.started_at,
        });
      } catch {
        // Telemetría no bloqueante
      }
    }

    try {
      // 8. Ciclo de Ejecución de Pasos Operativos
      let currentStepNumber = 1;

      // Verificar cancelación o timeout previo
      if (abortController.signal.aborted) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_CANCELLED,
          message: "La ejecución del agente fue cancelada.",
          statusCode: 499,
          agentId: agent.id,
          runId: run.id,
        });
      }

      // Paso 1: AI_REQUEST inicial
      const stepId1 = `step-${run.id}-${currentStepNumber}`;
      const aiStep: AgentRunStep = {
        id: stepId1,
        run_id: run.id,
        workspace_id: run.workspace_id,
        step_number: currentStepNumber,
        step_type: "AI_REQUEST",
        status: "running",
        input: { prompt: dto.input, instructions: agent.system_instructions },
        output: null,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      const aiResponse = await defaultAIGateway.execute(
        {
          requestId: `req-agent-${run.id}-${currentStepNumber}`,
          workspaceId: agent.workspace_id,
          userId: dto.user_id,
          model: agent.model_id,
          messages: [
            { role: "system", content: agent.system_instructions },
            { role: "user", content: dto.input },
          ],
          options: {
            maxTokens: effectiveMaxTokens,
            signal: abortController.signal,
          },
        },
        supabase
      );

      run.tokens_input += aiResponse.usage.inputTokens;
      run.tokens_output += aiResponse.usage.outputTokens;
      run.total_tokens = run.tokens_input + run.tokens_output;
      run.steps_count++;

      if (run.total_tokens > effectiveMaxTokens) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
          message: `El agente consumió ${run.total_tokens} tokens, superando el límite asignado de ${effectiveMaxTokens} tokens.`,
          statusCode: 429,
          agentId: agent.id,
          runId: run.id,
        });
      }

      aiStep.status = "completed";
      aiStep.completed_at = new Date().toISOString();
      aiStep.output = { content: aiResponse.content, usage: aiResponse.usage };
      steps.push(aiStep);
      currentStepNumber++;

      // Evaluar si se debe invocar una herramienta (forzada o inferida por comandos)
      const toolCall = dto.forced_tool_call || this.detectToolCall(dto.input, aiResponse.content);

      if (toolCall && currentStepNumber <= effectiveMaxSteps) {
        // Validar permisos de la herramienta
        const tool = defaultPermissionEngine.validateToolAccess(toolCall.tool_id, agent.tools || []);

        // 9. Verificar Aprobación Humana (Human-in-the-Loop)
        if (tool.requiresApproval || tool.riskLevel === "write" || tool.riskLevel === "destructive") {
          const approvalStepId = `step-${run.id}-${currentStepNumber}`;
          const approvalStep: AgentRunStep = {
            id: approvalStepId,
            run_id: run.id,
            workspace_id: run.workspace_id,
            step_number: currentStepNumber,
            step_type: "APPROVAL_REQUEST",
            status: "pending",
            tool_id: tool.id,
            input: { tool_id: tool.id, params: toolCall.params, riskLevel: tool.riskLevel },
            output: null,
            started_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          };

          steps.push(approvalStep);
          run.steps_count++;
          run.status = "waiting_approval";
          run.output = `[HUMAN-IN-THE-LOOP]: El agente solicita aprobación para ejecutar la herramienta '${tool.name}' (Riesgo: ${tool.riskLevel.toUpperCase()}).`;
          run.updated_at = new Date().toISOString();

          if (supabase) {
            await (supabase.from("agent_run_steps") as any).insert({
              id: approvalStep.id,
              run_id: approvalStep.run_id,
              workspace_id: approvalStep.workspace_id,
              step_number: approvalStep.step_number,
              step_type: approvalStep.step_type,
              status: approvalStep.status,
              tool_id: approvalStep.tool_id,
              input: approvalStep.input,
              started_at: approvalStep.started_at,
            });

            await (supabase.from("agent_runs") as any)
              .update({
                status: run.status,
                output: run.output,
                steps_count: run.steps_count,
                total_tokens: run.total_tokens,
              })
              .eq("id", run.id);
          }

          clearTimeout(timeoutHandle);
          return { run, steps, needsApproval: true, approvalStep };
        }

        // Si no requiere aprobación, ejecutar la herramienta de inmediato
        const toolStepId = `step-${run.id}-${currentStepNumber}`;
        const toolStep: AgentRunStep = {
          id: toolStepId,
          run_id: run.id,
          workspace_id: run.workspace_id,
          step_number: currentStepNumber,
          step_type: "TOOL_CALL",
          status: "running",
          tool_id: tool.id,
          input: toolCall.params,
          started_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        const execOutcome = await defaultToolExecutor.execute(tool.id, toolCall.params, {
          agentId: agent.id,
          runId: run.id,
          workspaceId: run.workspace_id,
          userId: dto.user_id,
          supabaseClient: supabase,
          signal: abortController.signal,
        });

        toolStep.status = "completed";
        toolStep.step_type = "TOOL_RESULT";
        toolStep.completed_at = new Date().toISOString();
        toolStep.output = execOutcome.result;
        steps.push(toolStep);

        run.tool_calls_count++;
        run.steps_count++;
        currentStepNumber++;

        if (run.tool_calls_count > agent.max_tool_calls) {
          throw new AgentError({
            code: AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
            message: `El agente excedió el número máximo de llamadas a herramientas permitidas (${agent.max_tool_calls}).`,
            statusCode: 429,
            agentId: agent.id,
            runId: run.id,
          });
        }

        // Sintetizar respuesta final
        run.output = `${aiResponse.content}\n\n[Resultado de ${tool.name}]: ${JSON.stringify(execOutcome.result, null, 2)}`;
      } else {
        run.output = aiResponse.content;
      }

      run.status = "completed";
      run.completed_at = new Date().toISOString();
      run.updated_at = new Date().toISOString();

      if (supabase) {
        await (supabase.from("agent_runs") as any)
          .update({
            status: run.status,
            output: run.output,
            tokens_input: run.tokens_input,
            tokens_output: run.tokens_output,
            total_tokens: run.total_tokens,
            steps_count: run.steps_count,
            tool_calls_count: run.tool_calls_count,
            completed_at: run.completed_at,
          })
          .eq("id", run.id);
      }

      clearTimeout(timeoutHandle);
      return { run, steps };
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      const isTimeout = err?.code === AgentErrorCodes.AGENT_TIMEOUT;
      const isCancelled = err?.code === AgentErrorCodes.AGENT_CANCELLED;

      run.status = isTimeout ? "timeout" : isCancelled ? "cancelled" : "failed";
      run.error_code = err?.code || AgentErrorCodes.INTERNAL_AGENT_ERROR;
      run.error_message = err?.message || "Fallo en la ejecución del agente.";
      run.completed_at = new Date().toISOString();
      run.updated_at = new Date().toISOString();

      if (supabase) {
        await (supabase.from("agent_runs") as any)
          .update({
            status: run.status,
            error_code: run.error_code,
            error_message: run.error_message,
            completed_at: run.completed_at,
          })
          .eq("id", run.id);
      }

      throw err;
    }
  }

  /**
   * Resuelve una solicitud de aprobación humana pendiente y reanuda el ciclo del agente.
   */
  public async resumeRunWithApproval(
    runId: string,
    stepId: string,
    decision: "approve" | "reject",
    comment?: string,
    supabase?: any,
    userId?: string
  ): Promise<ExecutionResult> {
    if (!supabase) {
      throw new AgentError({
        code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
        message: "Se requiere conexión a base de datos para resolver la aprobación.",
        statusCode: 500,
      });
    }

    // 1. Obtener Run y Step
    const { data: run, error: runErr } = await (supabase.from("agent_runs") as any)
      .select("*")
      .eq("id", runId)
      .single();

    if (runErr || !run) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_FOUND,
        message: "Run no encontrado.",
        statusCode: 404,
      });
    }

    if (run.status !== "waiting_approval") {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_ACTIVE,
        message: `El run está en estado '${run.status}', no está esperando aprobación.`,
        statusCode: 400,
      });
    }

    const { data: step, error: stepErr } = await (supabase.from("agent_run_steps") as any)
      .select("*")
      .eq("id", stepId)
      .eq("run_id", runId)
      .single();

    if (stepErr || !step) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_FOUND,
        message: "Paso de aprobación no encontrado.",
        statusCode: 404,
      });
    }

    const toolId = step.tool_id || step.input?.tool_id;
    const toolParams = step.input?.params || {};

    if (decision === "reject") {
      // Registrar paso como rechazado
      await (supabase.from("agent_run_steps") as any)
        .update({
          status: "failed",
          output: { decision: "rejected", comment: comment || "Rechazado por el operador" },
          error_code: "APPROVAL_REJECTED",
          completed_at: new Date().toISOString(),
        })
        .eq("id", stepId);

      // Finalizar run con estado completado informando del rechazo
      const finalOutput = `[ACCION DENEGADA]: El operador humano rechazó la ejecución de la herramienta '${toolId}'. Motivo: ${comment || "Sin comentario adicional"}. No se realizaron cambios.`;

      const { data: updatedRun } = await (supabase.from("agent_runs") as any)
        .update({
          status: "completed",
          output: finalOutput,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .select()
        .single();

      const { data: allSteps } = await (supabase.from("agent_run_steps") as any)
        .select("*")
        .eq("run_id", runId)
        .order("step_number", { ascending: true });

      return { run: updatedRun, steps: allSteps || [] };
    }

    // Decisión: APPROVE -> Ejecutar la herramienta en sandbox
    await (supabase.from("agent_run_steps") as any)
      .update({
        status: "completed",
        output: { decision: "approved", approved_by: userId },
        completed_at: new Date().toISOString(),
      })
      .eq("id", stepId);

    const execOutcome = await defaultToolExecutor.execute(toolId, toolParams, {
      agentId: run.agent_id,
      runId: run.id,
      workspaceId: run.workspace_id,
      userId: run.user_id,
      supabaseClient: supabase,
    });

    // Insertar paso de TOOL_RESULT
    const nextStepNumber = (run.steps_count || 1) + 1;
    const resultStepId = `step-${run.id}-${nextStepNumber}`;
    await (supabase.from("agent_run_steps") as any).insert({
      id: resultStepId,
      run_id: run.id,
      workspace_id: run.workspace_id,
      step_number: nextStepNumber,
      step_type: "TOOL_RESULT",
      status: "completed",
      tool_id: toolId,
      input: toolParams,
      output: execOutcome.result,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const finalOutput = `[AUTORIZADO]: La herramienta '${toolId}' fue aprobada y ejecutada exitosamente en el workspace.\n\nResultado:\n${JSON.stringify(execOutcome.result, null, 2)}`;

    const { data: completedRun } = await (supabase.from("agent_runs") as any)
      .update({
        status: "completed",
        output: finalOutput,
        tool_calls_count: (run.tool_calls_count || 0) + 1,
        steps_count: nextStepNumber,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select()
      .single();

    const { data: finalSteps } = await (supabase.from("agent_run_steps") as any)
      .select("*")
      .eq("run_id", runId)
      .order("step_number", { ascending: true });

    return { run: completedRun, steps: finalSteps || [] };
  }

  /**
   * Helper determinista para detectar llamadas estructuradas a tools en el texto o prompt.
   */
  private detectToolCall(input: string, content: string): { tool_id: string; params: Record<string, any> } | null {
    // 1. Detectar patrón explícito: [TOOL_CALL: tool_id] { ... }
    const match = content.match(/\[TOOL_CALL:\s*([a-zA-Z0-9_]+)\]\s*(\{[\s\S]*?\})/i);
    if (match) {
      try {
        const tool_id = match[1].toLowerCase().trim();
        const params = JSON.parse(match[2]);
        return { tool_id, params };
      } catch {
        // Ignorar si no es JSON válido
      }
    }

    // 2. Heurística segura para expresiones matemáticas
    const mathMatch = input.match(/(?:calcula|calcule|cu[aá]nto es|evalua)\s*[:=]?\s*([0-9+\-*/%^().,\s]+)/i);
    if (mathMatch && mathMatch[1].trim().length >= 3) {
      return {
        tool_id: "calculator",
        params: { expression: mathMatch[1].trim() },
      };
    }

    return null;
  }
}

export const defaultAgentRuntime = new AgentRuntime();
