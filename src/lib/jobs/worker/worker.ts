/**
 * NEXTEХ Episodic Serverless Worker (Fase 4.6)
 * Ejecución episódica acotada, recuperación de runs durables y preservación de authority.
 */

import { defaultJobQueue } from "../queue/queue";
import { LeaseManager } from "./lease";
import { defaultAgentRuntime } from "@/lib/agents/runtime/runtime";
import { defaultPolicyEngine } from "@/lib/agents/governance/policies";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { Agent } from "@/lib/agents/types";
import { AgentError, AgentErrorCodes } from "@/lib/agents/types/errors";
import { JobRun } from "../types";

export interface WorkerTickResult {
  processed: boolean;
  workerId: string;
  runId?: string;
  status?: string;
  message?: string;
  error?: string;
}

export class EpisodicWorker {
  /**
   * Ejecuta un ciclo de trabajo episódico acotado en tiempo (máximo 45 segundos).
   * Procesa exactamente a lo sumo 1 Job Run por invocación serverless.
   */
  public async executeTick(supabase?: any, customWorkerId?: string): Promise<WorkerTickResult> {
    const workerId = customWorkerId || `wrk-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const leaseManager = new LeaseManager({ maxInvocationMs: 45000, safetyMarginMs: 15000 });

    if (!supabase) {
      return {
        processed: false,
        workerId,
        message: "Cliente Supabase no configurado para este tick.",
      };
    }

    // 1. Reclamo Atómico de la Cola (Blocked-Candidate Skipping)
    let run: JobRun | null = null;
    try {
      run = await defaultJobQueue.claimNext(workerId, 60, supabase);
    } catch (err: any) {
      return {
        processed: false,
        workerId,
        error: `Fallo al reclamar run: ${err?.message}`,
      };
    }

    if (!run) {
      return {
        processed: false,
        workerId,
        message: "Cola vacía o sin jobs elegibles bajo cuotas vigentes.",
      };
    }

    // 2. Iniciar Heartbeat activo mientras la petición HTTP esté en curso
    leaseManager.startHeartbeat(run.id, workerId, run.fencing_token, supabase);

    try {
      // 3. JIT CURRENT RESOURCE AUTHORITY VALIDATION
      // Principio: No depende de created_by; evalúa estado del Workspace y del Agente
      const { data: agentData, error: agErr } = await (supabase.from("agents") as any)
        .select("*, agent_tools(tool_id, enabled)")
        .eq("id", run.agent_id)
        .eq("workspace_id", run.workspace_id)
        .single();

      if (agErr || !agentData) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_NOT_FOUND,
          message: "El agente vinculado al job no existe o no pertenece al workspace.",
          statusCode: 404,
        });
      }

      if (agentData.status !== "active") {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_NOT_ACTIVE,
          message: `El agente vinculado está en estado '${agentData.status}'. Solo agentes en estado 'active' pueden ejecutarse.`,
          statusCode: 400,
        });
      }

      const policy = defaultPolicyEngine.getDefaultPolicy(agentData.id, run.workspace_id);
      if (policy.allow_execution === false) {
        throw new AgentError({
          code: AgentErrorCodes.AGENT_EXECUTION_BLOCKED,
          message: "La política de seguridad del agente prohíbe su ejecución.",
          statusCode: 403,
        });
      }

      const agent: Agent = {
        ...agentData,
        tools: agentData.agent_tools?.filter((t: any) => t.enabled).map((t: any) => t.tool_id) || [],
      };

      // 4. VERIFICAR SI YA EXISTE UN AGENT RUN VINCULADO (REGLA: 1 Job Run = 1 Agent Run)
      let executionResult: any;

      const { data: existingAgentRun } = await (supabase.from("agent_runs") as any)
        .select("id, status")
        .eq("job_run_id", run.id)
        .maybeSingle();

      if (existingAgentRun) {
        // Recuperación y Reanudación de Agent Run existente
        executionResult = await defaultAgentRuntime.resumeInterruptedRun(
          existingAgentRun.id,
          supabase
        );
      } else {
        // Ejecución inicial: vincula job_run_id
        executionResult = await defaultAgentRuntime.executeRun(
          agent,
          {
            agent_id: agent.id,
            workspace_id: run.workspace_id,
            user_id: agentData.created_by, // Identidad de servicio en nombre del workspace
            input: run.input,
            job_run_id: run.id,
          },
          supabase
        );
      }

      // 5. EVALUAR RESULTADO
      if (executionResult.needsApproval) {
        // Suspensión HITL: Desacopla worker y libera lease
        leaseManager.stopHeartbeat();
        await defaultJobQueue.releaseForApproval(run.id, workerId, run.fencing_token, supabase);
        return {
          processed: true,
          workerId,
          runId: run.id,
          status: "waiting_approval",
          message: "Job Run suspendido en waiting_approval; lease liberado exitosamente.",
        };
      }

      // Si el presupuesto de tiempo está próximo a agotarse y se necesita continuación
      if (leaseManager.isBudgetExpiring()) {
        leaseManager.stopHeartbeat();
        await defaultJobQueue.checkpointAndRequeue(run.id, workerId, run.fencing_token, supabase);
        return {
          processed: true,
          workerId,
          runId: run.id,
          status: "checkpoint_requeued",
          message: "Presupuesto de ejecución alcanzado; run re-encolado para continuación.",
        };
      }

      // Completado exitosamente
      leaseManager.stopHeartbeat();
      await defaultJobQueue.complete(
        run.id,
        workerId,
        run.fencing_token,
        executionResult.run?.output || null,
        executionResult.run?.tokens_input || 0,
        executionResult.run?.tokens_output || 0,
        supabase
      );

      return {
        processed: true,
        workerId,
        runId: run.id,
        status: "completed",
        message: "Job Run completado exitosamente.",
      };
    } catch (err: any) {
      leaseManager.stopHeartbeat();
      const errorCode = err?.code || AgentErrorCodes.INTERNAL_AGENT_ERROR;
      const errorMessage = err?.message || "Fallo en la ejecución del job.";

      // Errores no reintentables: denegaciones de política, permisos, esquema inválido
      const nonRetryableCodes = [
        AgentErrorCodes.AGENT_PERMISSION_DENIED,
        AgentErrorCodes.AGENT_EXECUTION_BLOCKED,
        AgentErrorCodes.TOOL_NOT_ALLOWED,
        AgentErrorCodes.TOOL_SCHEMA_INVALID,
        "AUTHORIZATION_REVOKED",
      ];

      const isRetryable = !nonRetryableCodes.includes(errorCode as any);

      await defaultJobQueue.failAndRetry(
        run.id,
        workerId,
        run.fencing_token,
        errorCode,
        errorMessage,
        isRetryable,
        supabase
      );

      return {
        processed: true,
        workerId,
        runId: run.id,
        status: isRetryable ? "retry_scheduled" : "dead_letter",
        error: `${errorCode}: ${errorMessage}`,
      };
    }
  }
}

export const defaultEpisodicWorker = new EpisodicWorker();
