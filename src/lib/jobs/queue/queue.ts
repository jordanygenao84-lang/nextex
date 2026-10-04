/**
 * NEXTEХ Durable Jobs — Queue Engine (Fase 4.6)
 * Gestión transaccional de encolamiento, reclamo y ciclo de vida sobre PostgreSQL.
 */

import { JobRun, JobRunPriority } from "../types";

export class JobQueue {
  /**
   * Encola un nuevo Job Run en la base de datos de forma duradera.
   */
  public async enqueue(
    params: {
      workspaceId: string;
      jobId: string;
      agentId: string;
      input: string;
      priority?: JobRunPriority;
      automationId?: string | null;
      occurrenceId?: string | null;
      eventId?: string | null;
      configurationVersion?: number;
      configurationHash?: string;
    },
    supabase: any
  ): Promise<JobRun> {
    const priority = params.priority || "normal";

    if (!supabase) {
      // Fallback en memoria si no hay cliente (pruebas locales aisladas)
      const mockRun: JobRun = {
        id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        workspace_id: params.workspaceId,
        job_id: params.jobId,
        automation_id: params.automationId || null,
        occurrence_id: params.occurrenceId || null,
        agent_id: params.agentId,
        agent_run_id: null,
        priority,
        status: "queued",
        input: params.input,
        output: null,
        attempt: 1,
        max_attempts: 3,
        retry_of_run_id: null,
        fencing_token: 0,
        worker_id: null,
        lease_expires_at: null,
        configuration_version: params.configurationVersion || 1,
        configuration_hash: params.configurationHash || "mock-hash",
        tokens_input: 0,
        tokens_output: 0,
        total_tokens: 0,
        error_code: null,
        error_message: null,
        queued_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return mockRun;
    }

    const { data: jobData } = await supabase
      .from("jobs")
      .select("configuration_version, configuration_hash")
      .eq("id", params.jobId)
      .single();

    const configVersion = params.configurationVersion || jobData?.configuration_version || 1;
    const configHash = params.configurationHash || jobData?.configuration_hash || "initial-hash";

    const { data, error } = await supabase
      .from("job_runs")
      .insert({
        workspace_id: params.workspaceId,
        job_id: params.jobId,
        automation_id: params.automationId || null,
        occurrence_id: params.occurrenceId || null,
        event_id: params.eventId || null,
        agent_id: params.agentId,
        priority,
        status: "queued",
        input: params.input,
        configuration_version: configVersion,
        configuration_hash: configHash,
      })
      .select()
      .single();

    if (error) throw error;
    return data as JobRun;
  }

  /**
   * Reclama de forma atómica el siguiente Job Run elegible usando la RPC claim_job_run.
   */
  public async claimNext(
    workerId: string,
    leaseSeconds: number = 60,
    supabase?: any
  ): Promise<JobRun | null> {
    if (!supabase) return null;

    const { data, error } = await supabase.rpc("claim_job_run", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });

    if (error) throw error;
    if (!data || !data.claimed || !data.run) return null;

    return data.run as JobRun;
  }

  /**
   * Emite un latido (heartbeat) para renovar el lease temporal y confirmar fencing token.
   */
  public async heartbeat(
    runId: string,
    workerId: string,
    fencingToken: number | bigint,
    extendSeconds: number = 60,
    supabase?: any
  ): Promise<boolean> {
    if (!supabase) return true;

    const { data, error } = await supabase.rpc("heartbeat_job_run", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_fencing_token: Number(fencingToken),
      p_extend_seconds: extendSeconds,
    });

    if (error) return false;
    return data?.success === true;
  }

  /**
   * Sella un Job Run completado exitosamente.
   */
  public async complete(
    runId: string,
    workerId: string,
    fencingToken: number | bigint,
    output?: string | null,
    tokensInput: number = 0,
    tokensOutput: number = 0,
    supabase?: any
  ): Promise<boolean> {
    if (!supabase) return true;

    const { data, error } = await supabase.rpc("complete_job_run", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_fencing_token: Number(fencingToken),
      p_output: output || null,
      p_tokens_input: tokensInput,
      p_tokens_output: tokensOutput,
    });

    if (error) throw error;
    return data?.success === true;
  }

  /**
   * Registra un fallo y programa un reintento con backoff exponencial o pase a dead_letter.
   */
  public async failAndRetry(
    runId: string,
    workerId: string,
    fencingToken: number | bigint,
    errorCode: string,
    errorMessage: string,
    isRetryable: boolean = false,
    supabase?: any
  ): Promise<{ success: boolean; status?: string; retried?: boolean; nextRunId?: string }> {
    if (!supabase) return { success: true, status: isRetryable ? "failed" : "dead_letter", retried: isRetryable };

    const { data, error } = await supabase.rpc("fail_job_run_and_schedule_retry", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_fencing_token: Number(fencingToken),
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_is_retryable: isRetryable,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Desacopla el worker durante Human-in-the-Loop y transiciona a waiting_approval.
   */
  public async releaseForApproval(
    runId: string,
    workerId: string,
    fencingToken: number | bigint,
    supabase?: any
  ): Promise<boolean> {
    if (!supabase) return true;

    const { data, error } = await supabase.rpc("release_job_run_for_approval", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_fencing_token: Number(fencingToken),
    });

    if (error) throw error;
    return data?.success === true;
  }

  /**
   * Realiza un checkpoint de un run incompleto que se aproxima al timeout de la invocación serverless
   * y lo re-encola en alta prioridad para su continuación en la siguiente invocación.
   */
  public async checkpointAndRequeue(
    runId: string,
    workerId: string = "system",
    fencingToken: number | bigint = 0,
    supabase?: any
  ): Promise<boolean> {
    if (!supabase) return true;

    const { data, error } = await supabase.rpc("checkpoint_and_requeue_job_run", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_fencing_token: Number(fencingToken),
    });

    if (error) throw error;
    return data?.success === true;
  }
}

export const defaultJobQueue = new JobQueue();
