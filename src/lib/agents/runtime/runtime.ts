/**
 * NEXTEХ Agent Core — Agent Runtime
 * Orquestador central de ejecución segura de agentes autónomos.
 * REGLA: Reutiliza OmniEngine y AI Gateway de Fase 3. No implementa un sistema paralelo de IA.
 */

import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { defaultQuotaManager } from "@/lib/omniengine/quotas/quota-manager";
import { defaultPermissionEngine } from "./permission";
import {
  Agent,
  AgentRun,
  AgentRunStep,
  ExecuteAgentRunDTO,
} from "../types";
import { AgentError, AgentErrorCodes } from "../types/errors";
import { OmniEngineError, OmniErrorCodes } from "@/lib/omniengine/types/errors";

export interface ExecutionResult {
  run: AgentRun;
  steps: AgentRunStep[];
}

export class AgentRuntime {
  /**
   * Ejecuta un Agent Run con gobernanza de límites, RLS y OmniEngine.
   */
  public async executeRun(
    agent: Agent,
    dto: ExecuteAgentRunDTO,
    supabase?: any,
    externalSignal?: AbortSignal
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

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
        await supabase.from("agent_runs").insert({
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
      let isExecutionComplete = false;

      while (!isExecutionComplete && currentStepNumber <= effectiveMaxSteps) {
        // Verificar cancelación o timeout
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          if (reason?.message === "AGENT_TIMEOUT") {
            throw new AgentError({
              code: AgentErrorCodes.AGENT_TIMEOUT,
              message: `La ejecución del agente excedió el tiempo límite configurado (${effectiveTimeoutSec}s).`,
              statusCode: 504,
              agentId: agent.id,
              runId: run.id,
            });
          }
          throw new AgentError({
            code: AgentErrorCodes.AGENT_CANCELLED,
            message: "La ejecución del agente fue cancelada por el usuario.",
            statusCode: 499,
            agentId: agent.id,
            runId: run.id,
          });
        }

        // Registrar paso AI_REQUEST
        const stepId = `step-${run.id}-${currentStepNumber}`;
        const aiStep: AgentRunStep = {
          id: stepId,
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

        // Invocación a través del AI Gateway de OmniEngine (Fase 3)
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

        // Actualizar métricas acumuladas de tokens
        run.tokens_input += aiResponse.usage.inputTokens;
        run.tokens_output += aiResponse.usage.outputTokens;
        run.total_tokens = run.tokens_input + run.tokens_output;
        run.steps_count++;

        // Verificar límite de tokens por run
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

        // Si el agente requería tools o produjo una respuesta final
        run.output = aiResponse.content;
        isExecutionComplete = true;

        currentStepNumber++;
      }

      if (!isExecutionComplete && currentStepNumber > effectiveMaxSteps) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
          message: `El agente alcanzó el límite máximo de ${effectiveMaxSteps} pasos operativos sin completar la tarea.`,
          statusCode: 429,
          agentId: agent.id,
          runId: run.id,
        });
      }

      // Marcar run como completado
      run.status = "completed";
      run.completed_at = new Date().toISOString();
      run.updated_at = new Date().toISOString();

      if (supabase) {
        await supabase
          .from("agent_runs")
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
        await supabase
          .from("agent_runs")
          .update({
            status: run.status,
            error_code: run.error_code,
            error_message: run.error_message,
            completed_at: run.completed_at,
          })
          .eq("id", run.id);
      }

      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export const defaultAgentRuntime = new AgentRuntime();
