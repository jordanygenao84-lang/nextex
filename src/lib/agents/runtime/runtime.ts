/**
 * NEXTEХ Agent Core — Agent Runtime (Fase 4.3)
 * Orquestador central de ejecución segura de agentes autónomos.
 * Integra Tool Discovery filtrado, validación previa de esquemas y
 * serialización atómica anti-replay / anti-tampering en persistencia.
 */

import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { defaultQuotaManager } from "@/lib/omniengine/quotas/quota-manager";
import { defaultPermissionEngine } from "./permission";
import { defaultToolRegistry } from "../tools/registry";
import { defaultToolExecutor } from "../tools/executor";
import { computeApprovalPayloadHash } from "../tools/hash";
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
   * Ejecuta un Agent Run con gobernanza de límites, RLS, OmniEngine y Tool Discovery filtrado.
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
      // 8. Tool Discovery Filtrado: Solo inyectar herramientas activas asignadas a este agente
      const assignedTools = defaultToolRegistry.getToolsForAgent(agent.tools || []);
      const toolDocumentation = assignedTools
        .map(
          (t) =>
            `- ${t.id}@${t.version} (${t.name}): ${t.description} [Riesgo: ${t.riskLevel.toUpperCase()}]`
        )
        .join("\n");

      const enrichedSystemPrompt = assignedTools.length > 0
        ? `${agent.system_instructions}\n\n[HERRAMIENTAS AUTORIZADAS PARA ESTE AGENTE]:\n${toolDocumentation}\n\nPara invocar una herramienta autorizada, responde con el formato estructurado:\n[TOOL_CALL: id_herramienta]\n{\n  "parametro": "valor"\n}\n[/TOOL_CALL]`
        : agent.system_instructions;

      let currentStepNumber = 1;

      if (abortController.signal.aborted) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_CANCELLED,
          message: "La ejecución del agente fue cancelada.",
          statusCode: 499,
          agentId: agent.id,
          runId: run.id,
        });
      }

      // Paso 1: Inferencia con AI Gateway
      const stepId1 = `step-${run.id}-${currentStepNumber}`;
      const aiStep: AgentRunStep = {
        id: stepId1,
        run_id: run.id,
        workspace_id: run.workspace_id,
        step_number: currentStepNumber,
        step_type: "AI_REQUEST",
        status: "running",
        input: { prompt: dto.input, instructions: enrichedSystemPrompt },
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
            { role: "system", content: enrichedSystemPrompt },
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

      // Detectar llamada a herramienta
      const toolCall = dto.forced_tool_call || this.detectToolCall(dto.input, aiResponse.content);

      if (toolCall && currentStepNumber <= effectiveMaxSteps) {
        // Validar permisos y ciclo de vida de la herramienta en PermissionEngine
        const tool = defaultPermissionEngine.validateToolAccess(toolCall.tool_id, agent.tools || []);

        // 9. Verificar Aprobación Humana (Human-in-the-Loop) con Hash Criptográfico Anti-Replay
        if (tool.requiresApproval || tool.riskLevel === "write" || tool.riskLevel === "destructive") {
          const approvalStepId = `step-${run.id}-${currentStepNumber}`;

          // Generación de firma criptográfica inmutable
          const payloadHash = computeApprovalPayloadHash(
            run.id,
            approvalStepId,
            tool.id,
            tool.version,
            toolCall.params
          );

          const approvalStep: AgentRunStep = {
            id: approvalStepId,
            run_id: run.id,
            workspace_id: run.workspace_id,
            step_number: currentStepNumber,
            step_type: "APPROVAL_REQUEST",
            status: "pending",
            tool_id: tool.id,
            input: {
              tool_id: tool.id,
              tool_version: tool.version,
              params: toolCall.params,
              riskLevel: tool.riskLevel,
              category: tool.category,
              payload_hash: payloadHash,
            },
            output: null,
            started_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          };

          steps.push(approvalStep);
          run.steps_count++;
          run.status = "waiting_approval";
          run.output = `[HUMAN-IN-THE-LOOP]: El agente solicita aprobación para ejecutar la herramienta '${tool.name}@${tool.version}' (Riesgo: ${tool.riskLevel.toUpperCase()}).`;
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

        // Si no requiere aprobación (read), ejecutar con validación previa de esquema en ToolExecutor
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
          stepId: toolStepId,
          executionId: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          fencingToken: 1,
        });

        toolStep.status = "completed";
        toolStep.step_type = "TOOL_RESULT";
        toolStep.completed_at = new Date().toISOString();
        toolStep.output = execOutcome.data;
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

        run.output = `${aiResponse.content}\n\n[Resultado de ${tool.name}@${tool.version}]: ${JSON.stringify(execOutcome.data, null, 2)}`;
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
   * Resuelve una solicitud de aprobación humana pendiente con PROTECCIÓN ATÓMICA en persistencia.
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
        message: "Se requiere conexión a base de datos para resolver la aprobación de forma atómica.",
        statusCode: 500,
      });
    }

    // 1. Obtener Run
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

    // 2. Obtener el Step original para reconstruir el hash criptográfico
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

    if (step.step_type !== "APPROVAL_REQUEST") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_APPROVAL_INVALID,
        message: "El paso seleccionado no corresponde a una solicitud de aprobación.",
        statusCode: 400,
      });
    }

    // Anti-replay inmediato en lectura
    if (step.status !== "pending") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_APPROVAL_REPLAY,
        message: "Esta solicitud de aprobación ya fue procesada previamente.",
        statusCode: 409,
      });
    }

    const toolId = step.tool_id || step.input?.tool_id;
    const toolVersion = step.input?.tool_version || "1.0.0";
    const toolParams = step.input?.params || {};
    const recordedHash = step.input?.payload_hash;

    // 3. Validación de integridad criptográfica (Anti-Tampering)
    const expectedHash = computeApprovalPayloadHash(
      run.id,
      stepId,
      toolId,
      toolVersion,
      toolParams
    );

    if (recordedHash && recordedHash !== expectedHash) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_APPROVAL_INVALID,
        message: "La firma criptográfica del payload no coincide. Posible alteración en vuelo.",
        statusCode: 400,
      });
    }

    // 4. TRANSICIÓN ATÓMICA EN PERSISTENCIA (SERIALIZACIÓN ANTI-RACE CONDITION)
    // El filtro atómico `status = 'pending'` en PostgreSQL garantiza que si entran dos peticiones
    // simultáneas, solo una puede actualizar la fila. La otra recibe 0 registros afectados.
    const { data: updatedStep, error: updateErr } = await (supabase.from("agent_run_steps") as any)
      .update({
        status: decision === "approve" ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        output: {
          decision,
          approved_by: userId,
          payload_hash: expectedHash,
          comment: comment || null,
          resolved_at: new Date().toISOString(),
        },
      })
      .eq("id", stepId)
      .eq("run_id", runId)
      .eq("status", "pending") // <--- ATOMICIDAD DIRECTA EN POSTGRESQL
      .eq("step_type", "APPROVAL_REQUEST")
      .select()
      .maybeSingle();

    if (updateErr || !updatedStep) {
      // Si la actualización no afectó ninguna fila, otra solicitud concurrente ya la transicionó
      throw new AgentError({
        code: AgentErrorCodes.TOOL_APPROVAL_REPLAY,
        message: "Conflicto de concurrencia: la solicitud ya fue resuelta por otra transacción.",
        statusCode: 409,
      });
    }

    if (decision === "reject") {
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

    // Decisión: APPROVE -> Ejecución en Sandbox con ToolExecutor y SchemaValidator
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const execOutcome = await defaultToolExecutor.execute(toolId, toolParams, {
      agentId: run.agent_id,
      runId: run.id,
      workspaceId: run.workspace_id,
      userId: run.user_id,
      supabaseClient: supabase,
      stepId: stepId,
      executionId: executionId,
      fencingToken: 1,
      expectedPayloadHash: expectedHash,
    });

    // Registrar paso TOOL_RESULT
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
      output: execOutcome.data,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const finalOutput = `[AUTORIZADO]: La herramienta '${toolId}@${toolVersion}' fue aprobada y ejecutada exitosamente en el workspace.\n\nResultado:\n${JSON.stringify(execOutcome.data, null, 2)}`;

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
    const match = content.match(/\[TOOL_CALL:\s*([a-zA-Z0-9_@.-]+)\]\s*(\{[\s\S]*?\})/i);
    if (match) {
      try {
        const tool_id = match[1].toLowerCase().trim();
        const params = JSON.parse(match[2]);
        return { tool_id, params };
      } catch {
        // Ignorar si no es JSON válido
      }
    }

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
