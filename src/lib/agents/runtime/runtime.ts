/**
 * NEXTEХ Agent Core — Agent Runtime (Fase 4.4 & 4.5)
 * Orquestador central de ejecución segura de agentes autónomos.
 * Integra AuthorizationEngine, PolicyEngine, Tool Discovery filtrado,
 * validación previa de esquemas, Human-in-the-Loop desacoplado (APPROVED != COMPLETED),
 * serialización atómica anti-replay / anti-tampering y Subsistema de Memoria Cognitiva (Fase 4.5).
 */

import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { defaultQuotaManager } from "@/lib/omniengine/quotas/quota-manager";
import { defaultPermissionEngine } from "./permission";
import { defaultToolRegistry } from "../tools/registry";
import { defaultToolExecutor } from "../tools/executor";
import { computeApprovalPayloadHash } from "../tools/hash";
import { defaultAuthorizationEngine } from "../governance/authorization";
import { defaultApprovalGovernance } from "../governance/approval";
import { defaultPolicyEngine } from "../governance/policies";
import { defaultMemoryService } from "../memory/service";
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
   * Ejecuta un Agent Run con gobernanza de límites, cuotas, AuthorizationEngine y Tool Discovery filtrado.
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

    // 4. AUTORIZACIÓN CENTRALIZADA: AuthorizationEngine evalúa permiso 'runs.execute' y políticas
    const initialAuthz = await defaultAuthorizationEngine.evaluate(
      {
        userId: dto.user_id,
        workspaceId: dto.workspace_id,
        agentId: agent.id,
      },
      {
        agent,
        supabaseClient: supabase,
      }
    );

    if (initialAuthz.decision === "deny") {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
        message: initialAuthz.reason,
        statusCode: 403,
        agentId: agent.id,
      });
    }

    // 5. Obtener perfil para cuotas de inferencia
    let userPlan: "free" | "pro" | "enterprise" = "free";
    if (supabase) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", dto.user_id)
        .maybeSingle();

      userPlan = (profile?.plan as any) || "free";
    }

    // 6. Jerarquía de límites: el límite más restrictivo siempre prevalece
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

    // 7. Preparar Timeout y Cancelación
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error("AGENT_TIMEOUT"));
    }, effectiveTimeoutSec * 1000);

    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        abortController.abort(new Error("AGENT_CANCELLED"));
      });
    }

    // 8. Creación Transaccional Única de Run con Concurrencia Centralizada en Base de Datos (Single Creation Path)
    let run: AgentRun;
    if (supabase) {
      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        "create_agent_run_with_concurrency_check",
        {
          p_agent_id: agent.id,
          p_input: dto.input,
          p_user_id: dto.user_id,
        }
      );

      if (rpcErr) {
        throw new AgentError({
          code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: rpcErr.message || "Fallo al invocar create_agent_run_with_concurrency_check.",
          statusCode: 500,
          agentId: agent.id,
        });
      }

      if (!rpcResult || !rpcResult.success) {
        const errCode = rpcResult?.error_code || AgentErrorCodes.INTERNAL_AGENT_ERROR;
        const errMsg = rpcResult?.error_message || "Fallo en la creación transaccional del run.";
        let statusCode = 500;
        if (errCode === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT) {
          statusCode = 429;
        } else if (errCode === AgentErrorCodes.AGENT_NOT_ACTIVE) {
          statusCode = 400;
        } else if (
          errCode === AgentErrorCodes.AGENT_PERMISSION_DENIED ||
          errCode === AgentErrorCodes.AGENT_EXECUTION_BLOCKED
        ) {
          statusCode = 403;
        } else if (errCode === "AUTH_REQUIRED") {
          statusCode = 401;
        } else if (errCode === AgentErrorCodes.AGENT_NOT_FOUND) {
          statusCode = 404;
        }

        throw new AgentError({
          code: errCode as any,
          message: errMsg,
          statusCode,
          agentId: agent.id,
        });
      }

      const createdRunRecord = rpcResult.run;
      run = {
        id: createdRunRecord.id,
        workspace_id: createdRunRecord.workspace_id,
        agent_id: createdRunRecord.agent_id,
        user_id: createdRunRecord.user_id,
        status: createdRunRecord.status || "running",
        input: createdRunRecord.input,
        output: null,
        model_id: createdRunRecord.model_id || agent.model_id,
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        steps_count: 0,
        tool_calls_count: 0,
        started_at: createdRunRecord.started_at || new Date().toISOString(),
        completed_at: null,
        error_code: null,
        error_message: null,
        created_at: createdRunRecord.created_at || new Date().toISOString(),
        updated_at: createdRunRecord.updated_at || new Date().toISOString(),
        job_run_id: dto.job_run_id || null,
        fencing_token: dto.fencing_token ?? 0,
        worker_id: dto.worker_id ?? null,
      };

      if (dto.job_run_id) {
        await (supabase.from("agent_runs") as any)
          .update({ job_run_id: dto.job_run_id })
          .eq("id", run.id);
      }
    } else {
      // Entorno en memoria sin conexión a base de datos
      const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      run = {
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
        job_run_id: dto.job_run_id || null,
        fencing_token: dto.fencing_token ?? 0,
        worker_id: dto.worker_id ?? null,
      };
    }

    const steps: AgentRunStep[] = [];
    const policy = defaultPolicyEngine.getDefaultPolicy(agent.id, agent.workspace_id);

    try {
      // 9. PRE-RUN: RECUPERACIÓN DE MEMORIA COGNITIVA (GROUNDING DATA ONLY)
      // Principio: MEMORY != SYSTEM INSTRUCTIONS. Grounding desconfiado en User Context.
      let formattedMemories = "";
      if (policy.memory_enabled !== false && policy.memory_retrieval_mode !== "disabled") {
        try {
          const retrievalRes = await defaultMemoryService.retrieveMemories(
            {
              query: dto.input,
              agentId: agent.id,
              userId: dto.user_id,
              runId: run.id,
            },
            {
              workspaceId: agent.workspace_id,
              userId: dto.user_id,
              policy,
              supabaseClient: supabase,
            }
          );
          if (retrievalRes.memories.length > 0) {
            formattedMemories = defaultMemoryService.formatMemoriesForPrompt(retrievalRes.memories);
          }
        } catch {
          // Fallback seguro: una falla en el subsistema de memoria jamás bloquea la ejecución del agente
        }
      }

      // 10. Tool Discovery Filtrado: Solo inyectar herramientas activas asignadas a este agente
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

      // Inferencia con AI Gateway
      // La memoria entra estrictamente en el prompt de usuario delimitada, NUNCA en role: 'system'
      const userMessageContent = formattedMemories
        ? `${formattedMemories}\n\n${dto.input}`
        : dto.input;

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
            { role: "user", content: userMessageContent },
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
        // 11. EVALUACIÓN FORMAL EN AuthorizationEngine (MEMORY != AUTHORITY)
        const tool = defaultPermissionEngine.validateToolAccess(toolCall.tool_id, agent.tools || []);

        const authzDecision = await defaultAuthorizationEngine.evaluate(
          {
            userId: dto.user_id,
            workspaceId: dto.workspace_id,
            agentId: agent.id,
            toolId: tool.id,
            toolVersion: tool.version,
            params: toolCall.params,
            runId: run.id,
          },
          {
            agent,
            supabaseClient: supabase,
          }
        );

        if (authzDecision.decision === "deny") {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_NOT_ALLOWED,
            message: `Acción denegada por AuthorizationEngine: ${authzDecision.reason}`,
            statusCode: 403,
            toolId: tool.id,
            runId: run.id,
          });
        }

        // 12. GOBERNANZA HITL: Si requiere aprobación, suspender y crear ApprovalRequest
        if (authzDecision.decision === "approval_required") {
          const approvalStepId = `step-${run.id}-${currentStepNumber}`;

          // Generación de firma criptográfica inmutable RFC 8785
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
            // Persistir paso en agent_run_steps
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

            // Persistir entidad formal en approval_requests (Fase 4.4)
            const formalApproval = defaultApprovalGovernance.createApprovalRequest(
              run.workspace_id,
              run.id,
              approvalStep.id,
              tool.id,
              tool.version,
              run.user_id,
              tool.riskLevel,
              toolCall.params
            );

            await (supabase.from("approval_requests") as any).insert({
              id: formalApproval.id,
              workspace_id: formalApproval.workspace_id,
              run_id: formalApproval.run_id,
              step_id: formalApproval.step_id,
              tool_id: formalApproval.tool_id,
              tool_version: formalApproval.tool_version,
              requester_id: formalApproval.requester_id,
              required_permission: formalApproval.required_permission,
              risk_level: formalApproval.risk_level,
              payload_hash: formalApproval.payload_hash,
              status: formalApproval.status,
              expires_at: formalApproval.expires_at,
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

        // 13. SI LA HERRAMIENTA ESTÁ AUTORIZADA DIRECTAMENTE (ALLOW)
        const toolStepId = `step-${run.id}-${currentStepNumber}`;
        const effectiveFencingToken = dto.fencing_token ?? (run.fencing_token || 0);
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
          fencing_token: effectiveFencingToken,
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
          fencingToken: effectiveFencingToken,
          jobRunId: dto.job_run_id || undefined,
          workerId: dto.worker_id || undefined,
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

      // 14. POST-RUN MEMORY INGESTION (Solo si el run completó exitosamente)
      // Principio: Fallo/Aborto no genera recuerdos
      if (policy.memory_enabled !== false && policy.memory_write_mode !== "disabled") {
        try {
          const lastStep = steps[steps.length - 1];
          await defaultMemoryService.ingestMemory(
            {
              content: `Entrada: ${dto.input.trim()} -> Salida: ${run.output?.substring(0, 1000).trim() || ""}`,
              type: "episodic",
              scope: "agent",
              summary: `Ejecución de agente ${agent.name} sobre prompt: ${dto.input.substring(0, 100)}`,
            },
            {
              agentId: agent.id,
              workspaceId: agent.workspace_id,
              userId: dto.user_id,
              policy,
              sourceRunId: run.id,
              sourceStepId: lastStep?.id || null,
              supabaseClient: supabase,
            }
          );
        } catch {
          // La consolidación de memoria post-run no debe alterar el resultado exitoso del run
        }
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

      // Cero ingestión de memoria ante error, timeout o cancelación
      throw err;
    }
  }

  /**
   * Resuelve una solicitud de aprobación humana pendiente con JIT REVALIDATION y ejecución desacoplada.
   * REGLA: APPROVED NO SIGNIFICA COMPLETED. La herramienta se ejecuta en ToolExecutor tras la aprobación.
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

    // 2. Obtener Step y ApprovalRequest correspondiente
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

    const { data: approvalRecord } = await (supabase.from("approval_requests") as any)
      .select("*")
      .eq("step_id", stepId)
      .maybeSingle();

    const toolId = step.tool_id || step.input?.tool_id;
    const toolVersion = step.input?.tool_version || "1.0.0";
    const toolParams = step.input?.params || {};
    const expectedHash = computeApprovalPayloadHash(run.id, stepId, toolId, toolVersion, toolParams);

    // 3. RESOLVER APROBACIÓN MEDIANTE RPC TRANSACCIONAL V2 (JIT REVALIDATION)
    if (approvalRecord) {
      const jitResult = await defaultApprovalGovernance.resolveApproval({
        approvalId: approvalRecord.id,
        approverId: userId || "",
        expectedPayloadHash: expectedHash,
        decision,
        comment,
        supabaseClient: supabase,
      });

      if (decision === "reject") {
        const finalOutput = `[ACCION DENEGADA]: El operador humano rechazó la ejecución de la herramienta '${toolId}'. Motivo: ${comment || "Sin comentario adicional"}.`;
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

      // Si fue aprobado: APPROVED NO SIGNIFICA COMPLETED.
      // El step ya está en 'running'. Ahora se procede a la ejecución física en ToolExecutor.
      const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let execOutcome: any;
      try {
        execOutcome = await defaultToolExecutor.execute(toolId, toolParams, {
          agentId: run.agent_id,
          runId: run.id,
          workspaceId: run.workspace_id,
          userId: run.user_id,
          supabaseClient: supabase,
          stepId: stepId,
          executionId: executionId,
          fencingToken: jitResult.fencingToken || 1,
          expectedPayloadHash: expectedHash,
          jobRunId: run.job_run_id || undefined,
          workerId: run.worker_id || undefined,
        });
      } catch (execErr: any) {
        // Si la herramienta falla tras la aprobación, el step pasa a failed
        await (supabase.from("agent_run_steps") as any)
          .update({
            status: "failed",
            error_code: execErr?.code || AgentErrorCodes.TOOL_EXECUTION_FAILED,
            completed_at: new Date().toISOString(),
          })
          .eq("id", stepId);

        throw execErr;
      }

      // Ejecución física concluida: sella step como completed
      await (supabase.from("agent_run_steps") as any)
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          output: execOutcome.data,
        })
        .eq("id", stepId);

      const finalOutput = `[AUTORIZADO]: La herramienta '${toolId}@${toolVersion}' fue aprobada y ejecutada exitosamente.\n\nResultado:\n${JSON.stringify(execOutcome.data, null, 2)}`;

      const { data: completedRun } = await (supabase.from("agent_runs") as any)
        .update({
          status: "completed",
          output: finalOutput,
          tool_calls_count: (run.tool_calls_count || 0) + 1,
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

    // Fallback de retrocompatibilidad directa
    const { data: updatedStep, error: updateErr } = await (supabase.from("agent_run_steps") as any)
      .update({
        status: decision === "approve" ? "running" : "failed",
        completed_at: decision === "reject" ? new Date().toISOString() : null,
        output: {
          decision,
          approved_by: userId,
          payload_hash: expectedHash,
          comment: comment || null,
        },
      })
      .eq("id", stepId)
      .eq("run_id", runId)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (updateErr || !updatedStep) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_APPROVAL_REPLAY,
        message: "Conflicto de concurrencia: la solicitud ya fue resuelta.",
        statusCode: 409,
      });
    }

    if (decision === "reject") {
      const finalOutput = `[ACCION DENEGADA]: El operador humano rechazó la ejecución de la herramienta '${toolId}'.`;
      const { data: updatedRun } = await (supabase.from("agent_runs") as any)
        .update({ status: "completed", output: finalOutput, completed_at: new Date().toISOString() })
        .eq("id", runId)
        .select()
        .single();

      const { data: allSteps } = await (supabase.from("agent_run_steps") as any)
        .select("*")
        .eq("run_id", runId)
        .order("step_number", { ascending: true });

      return { run: updatedRun, steps: allSteps || [] };
    }

    // Ejecutar herramienta
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const execOutcome = await defaultToolExecutor.execute(toolId, toolParams, {
      agentId: run.agent_id,
      runId: run.id,
      workspaceId: run.workspace_id,
      userId: run.user_id,
      supabaseClient: supabase,
      stepId: stepId,
      executionId: executionId,
      fencingToken: run.fencing_token || 0,
      expectedPayloadHash: expectedHash,
      jobRunId: run.job_run_id || undefined,
      workerId: run.worker_id || undefined,
    });

    await (supabase.from("agent_run_steps") as any)
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output: execOutcome.data,
      })
      .eq("id", stepId);

    const finalOutput = `[AUTORIZADO]: La herramienta '${toolId}@${toolVersion}' fue ejecutada.\n\nResultado:\n${JSON.stringify(execOutcome.data, null, 2)}`;
    const { data: completedRun } = await (supabase.from("agent_runs") as any)
      .update({
        status: "completed",
        output: finalOutput,
        tool_calls_count: (run.tool_calls_count || 0) + 1,
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
   * Reanuda un Agent Run interrumpido/recuperado tras un crash de worker.
   * REGLA: 1 Job Run = 1 Agent Run. NO crea un segundo Agent Run.
   * Reconcilia los steps durables existentes en agent_run_steps y el tool_idempotency_ledger.
   */
  public async resumeInterruptedRun(
    agentRunId: string,
    supabase: any,
    externalSignal?: AbortSignal,
    options?: {
      fencingToken?: number | bigint;
      workerId?: string;
    }
  ): Promise<ExecutionResult> {
    if (!supabase) {
      throw new AgentError({
        code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
        message: "Se requiere cliente de base de datos para reanudar un Agent Run.",
        statusCode: 500,
      });
    }

    // 1. Obtener AgentRun
    const { data: runRecord, error: runErr } = await (supabase.from("agent_runs") as any)
      .select("*")
      .eq("id", agentRunId)
      .single();

    if (runErr || !runRecord) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_FOUND,
        message: "Agent Run no encontrado para recuperación.",
        statusCode: 404,
      });
    }

    // 2. Obtener steps existentes
    const { data: stepsRecords } = await (supabase.from("agent_run_steps") as any)
      .select("*")
      .eq("run_id", agentRunId)
      .order("step_number", { ascending: true });

    const steps: AgentRunStep[] = stepsRecords || [];

    // Verificación estricta de aislamiento multi-tenant e integridad de linaje
    for (const step of steps) {
      if (step.workspace_id !== runRecord.workspace_id || step.run_id !== runRecord.id) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
          message: `Discrepancia de seguridad: el paso '${step.id}' no pertenece al run '${runRecord.id}' o al workspace '${runRecord.workspace_id}'.`,
          statusCode: 403,
          runId: runRecord.id,
        });
      }
    }

    // Si el run ya se encuentra en un estado terminal, respetar inmutabilidad y retornar
    if (["completed", "failed", "cancelled", "timeout"].includes(runRecord.status)) {
      return { run: runRecord, steps };
    }

    // 3. Obtener Agente asociado
    const { data: agentData, error: agErr } = await (supabase.from("agents") as any)
      .select("*, agent_tools(tool_id, enabled)")
      .eq("id", runRecord.agent_id)
      .single();

    if (agErr || !agentData) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_FOUND,
        message: "Agente vinculado al run no encontrado.",
        statusCode: 404,
      });
    }

    if (agentData.status !== "active") {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_ACTIVE,
        message: `El agente está en estado '${agentData.status}'. Solo agentes en estado 'active' pueden reanudarse.`,
        statusCode: 400,
        agentId: agentData.id,
      });
    }

    const agent: Agent = {
      ...agentData,
      tools: agentData.agent_tools?.filter((t: any) => t.enabled).map((t: any) => t.tool_id) || [],
    };

    const effectiveFencingToken = options?.fencingToken ?? (runRecord.fencing_token || 0);
    const effectiveWorkerId = options?.workerId ?? runRecord.worker_id ?? undefined;

    // 4. Reconciliar el último step si quedó en running o pending
    const lastStep = steps[steps.length - 1];
    if (lastStep && (lastStep.status === "running" || lastStep.status === "pending")) {
      if (lastStep.step_type === "APPROVAL_REQUEST" && lastStep.status === "pending") {
        return { run: runRecord, steps, needsApproval: true, approvalStep: lastStep };
      }

      if (lastStep.step_type === "TOOL_CALL") {
        // Reconciliar con tool_idempotency_ledger
        const { data: ledgerEntry } = await (supabase.from("tool_idempotency_ledger") as any)
          .select("*")
          .eq("step_id", lastStep.id)
          .maybeSingle();

        if (ledgerEntry && ledgerEntry.status === "committed") {
          // Mutación física ya ocurrió en PostgreSQL -> reutilizar resultado sin duplicar
          lastStep.status = "completed";
          lastStep.step_type = "TOOL_RESULT";
          lastStep.output = ledgerEntry.result;
          lastStep.completed_at = ledgerEntry.created_at;
          await (supabase.from("agent_run_steps") as any)
            .update({ status: "completed", step_type: "TOOL_RESULT", output: lastStep.output, completed_at: lastStep.completed_at })
            .eq("id", lastStep.id);
        } else {
          // No se consolidó en el ledger: re-ejecutar herramienta bajo nuevo fencing token
          const toolId = lastStep.tool_id || (lastStep.input as any)?.tool_id;
          const params = (lastStep.input as any)?.params || lastStep.input || {};
          const execOutcome = await defaultToolExecutor.execute(toolId, params, {
            agentId: agent.id,
            runId: runRecord.id,
            workspaceId: runRecord.workspace_id,
            userId: runRecord.user_id,
            supabaseClient: supabase,
            signal: externalSignal,
            stepId: lastStep.id,
            executionId: `exec-rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            fencingToken: effectiveFencingToken,
            jobRunId: runRecord.job_run_id || undefined,
            workerId: effectiveWorkerId,
          });

          lastStep.status = "completed";
          lastStep.step_type = "TOOL_RESULT";
          lastStep.completed_at = new Date().toISOString();
          lastStep.output = execOutcome.data;
          await (supabase.from("agent_run_steps") as any)
            .update({ status: "completed", step_type: "TOOL_RESULT", output: lastStep.output, completed_at: lastStep.completed_at })
            .eq("id", lastStep.id);
        }
      } else if (lastStep.step_type === "AI_REQUEST") {
        if (lastStep.output && (lastStep.output as any).content) {
          lastStep.status = "completed";
          await (supabase.from("agent_run_steps") as any)
            .update({ status: "completed" })
            .eq("id", lastStep.id);
        } else {
          // Re-ejecutar AI Gateway para este paso con requestId determinista
          const assignedTools = defaultToolRegistry.getToolsForAgent(agent.tools || []);
          const toolDocumentation = assignedTools
            .map((t) => `- ${t.id}@${t.version} (${t.name}): ${t.description} [Riesgo: ${t.riskLevel.toUpperCase()}]`)
            .join("\n");
          const enrichedSystemPrompt = assignedTools.length > 0
            ? `${agent.system_instructions}\n\n[HERRAMIENTAS AUTORIZADAS PARA ESTE AGENTE]:\n${toolDocumentation}\n\nPara invocar una herramienta autorizada, responde con el formato estructurado:\n[TOOL_CALL: id_herramienta]\n{\n  "parametro": "valor"\n}\n[/TOOL_CALL]`
            : agent.system_instructions;

          const aiResponse = await defaultAIGateway.execute(
            {
              requestId: `req-agent-${runRecord.id}-${lastStep.step_number}`,
              workspaceId: agent.workspace_id,
              userId: runRecord.user_id,
              model: agent.model_id,
              messages: [
                { role: "system", content: enrichedSystemPrompt },
                { role: "user", content: runRecord.input },
              ],
              options: {
                maxTokens: agent.max_tokens,
                signal: externalSignal,
              },
            },
            supabase
          );

          lastStep.status = "completed";
          lastStep.completed_at = new Date().toISOString();
          lastStep.output = { content: aiResponse.content, usage: aiResponse.usage };

          await (supabase.from("agent_run_steps") as any)
            .update({
              status: "completed",
              completed_at: lastStep.completed_at,
              output: lastStep.output,
            })
            .eq("id", lastStep.id);
        }
      }
    }

    // 5. Verificar si hay un paso en waiting_approval tras reconciliación
    const pendingApproval = steps.find((s) => s.step_type === "APPROVAL_REQUEST" && s.status === "pending");
    if (pendingApproval) {
      return { run: runRecord, steps, needsApproval: true, approvalStep: pendingApproval };
    }

    // 6. CONTINUAR EL FLUJO COGNITIVO DEL AGENTE SI FALTAN PASOS
    if (steps.length === 0) {
      return this.executeRun(
        agent,
        {
          agent_id: agent.id,
          workspace_id: runRecord.workspace_id,
          user_id: runRecord.user_id,
          input: runRecord.input,
          job_run_id: runRecord.job_run_id || undefined,
          fencing_token: effectiveFencingToken,
          worker_id: effectiveWorkerId,
        },
        supabase,
        externalSignal
      );
    }

    const lastCompleted = steps[steps.length - 1];
    const nextStepNumber = steps.length + 1;

    if (lastCompleted.step_type === "AI_REQUEST") {
      const aiContent = (lastCompleted.output as any)?.content || "";
      const toolCall = this.detectToolCall(runRecord.input, aiContent);

      if (toolCall && nextStepNumber <= agent.max_steps && (runRecord.tool_calls_count || 0) < agent.max_tool_calls) {
        const tool = defaultPermissionEngine.validateToolAccess(toolCall.tool_id, agent.tools || []);
        const authzDecision = await defaultAuthorizationEngine.evaluate(
          {
            userId: runRecord.user_id,
            workspaceId: runRecord.workspace_id,
            agentId: agent.id,
            toolId: tool.id,
            toolVersion: tool.version,
            params: toolCall.params,
            runId: runRecord.id,
          },
          { agent, supabaseClient: supabase }
        );

        if (authzDecision.decision === "deny") {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_NOT_ALLOWED,
            message: `Acción denegada por AuthorizationEngine: ${authzDecision.reason}`,
            statusCode: 403,
            toolId: tool.id,
            runId: runRecord.id,
          });
        }

        if (authzDecision.decision === "approval_required") {
          const approvalStepId = `step-${runRecord.id}-${nextStepNumber}`;
          const payloadHash = computeApprovalPayloadHash(runRecord.id, approvalStepId, tool.id, tool.version, toolCall.params);
          const approvalStep: AgentRunStep = {
            id: approvalStepId,
            run_id: runRecord.id,
            workspace_id: runRecord.workspace_id,
            step_number: nextStepNumber,
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

          const formalApproval = defaultApprovalGovernance.createApprovalRequest(
            runRecord.workspace_id,
            runRecord.id,
            approvalStep.id,
            tool.id,
            tool.version,
            runRecord.user_id,
            tool.riskLevel,
            toolCall.params
          );

          await (supabase.from("approval_requests") as any).insert({
            id: formalApproval.id,
            workspace_id: formalApproval.workspace_id,
            run_id: formalApproval.run_id,
            step_id: formalApproval.step_id,
            tool_id: formalApproval.tool_id,
            tool_version: formalApproval.tool_version,
            requester_id: formalApproval.requester_id,
            required_permission: formalApproval.required_permission,
            risk_level: formalApproval.risk_level,
            payload_hash: formalApproval.payload_hash,
            status: formalApproval.status,
            expires_at: formalApproval.expires_at,
          });

          const waitingOutput = `[HUMAN-IN-THE-LOOP]: El agente solicita aprobación para ejecutar la herramienta '${tool.name}@${tool.version}' (Riesgo: ${tool.riskLevel.toUpperCase()}).`;
          await (supabase.from("agent_runs") as any)
            .update({
              status: "waiting_approval",
              output: waitingOutput,
              steps_count: steps.length,
            })
            .eq("id", runRecord.id);

          runRecord.status = "waiting_approval";
          runRecord.output = waitingOutput;
          return { run: runRecord, steps, needsApproval: true, approvalStep };
        }

        // Si fue allowed: ejecutar herramienta con barrera de cercado
        const toolStepId = `step-${runRecord.id}-${nextStepNumber}`;
        const toolStep: AgentRunStep = {
          id: toolStepId,
          run_id: runRecord.id,
          workspace_id: runRecord.workspace_id,
          step_number: nextStepNumber,
          step_type: "TOOL_CALL",
          status: "running",
          tool_id: tool.id,
          input: toolCall.params,
          started_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          fencing_token: effectiveFencingToken,
        };

        const execOutcome = await defaultToolExecutor.execute(tool.id, toolCall.params, {
          agentId: agent.id,
          runId: runRecord.id,
          workspaceId: runRecord.workspace_id,
          userId: runRecord.user_id,
          supabaseClient: supabase,
          signal: externalSignal,
          stepId: toolStepId,
          executionId: `exec-rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          fencingToken: effectiveFencingToken,
          jobRunId: runRecord.job_run_id || undefined,
          workerId: effectiveWorkerId,
        });

        toolStep.status = "completed";
        toolStep.step_type = "TOOL_RESULT";
        toolStep.completed_at = new Date().toISOString();
        toolStep.output = execOutcome.data;
        steps.push(toolStep);

        await (supabase.from("agent_run_steps") as any).insert({
          id: toolStep.id,
          run_id: toolStep.run_id,
          workspace_id: toolStep.workspace_id,
          step_number: toolStep.step_number,
          step_type: toolStep.step_type,
          status: toolStep.status,
          tool_id: toolStep.tool_id,
          input: toolStep.input,
          output: toolStep.output,
          started_at: toolStep.started_at,
          completed_at: toolStep.completed_at,
          fencing_token: effectiveFencingToken,
        });

        runRecord.tool_calls_count = (runRecord.tool_calls_count || 0) + 1;
        runRecord.steps_count = steps.length;
        runRecord.output = `${aiContent}\n\n[Resultado de ${tool.name}@${tool.version}]: ${JSON.stringify(execOutcome.data, null, 2)}`;
      } else {
        runRecord.output = aiContent;
      }
    } else if (lastCompleted.step_type === "TOOL_RESULT" || lastCompleted.step_type === "TOOL_CALL") {
      if (!runRecord.output) {
        const firstStep = steps.find((s) => s.step_type === "AI_REQUEST");
        const aiText = (firstStep?.output as any)?.content || "";
        runRecord.output = `${aiText}\n\n[Resultado]: ${JSON.stringify(lastCompleted.output, null, 2)}`;
      }
    }

    // 7. Sellar finalización natural
    runRecord.status = "completed";
    runRecord.completed_at = new Date().toISOString();
    runRecord.updated_at = new Date().toISOString();
    runRecord.steps_count = steps.length;

    await (supabase.from("agent_runs") as any)
      .update({
        status: "completed",
        output: runRecord.output,
        steps_count: runRecord.steps_count,
        tool_calls_count: runRecord.tool_calls_count,
        completed_at: runRecord.completed_at,
      })
      .eq("id", runRecord.id);

    return { run: runRecord, steps };
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

    const mathMatch = input.match(/(?:calcula|calcule|cu[aá]nto es|evalua)\s*[:=]?\s*([0-9+\-*\/%^().,\s]+)/i);
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
