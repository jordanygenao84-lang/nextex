/**
 * NEXTEХ Durable Jobs — Unified Job Engine (Fase 4.6)
 * Orquestación central de creación, versionado de configuración,
 * control de estados, disparos manuales y automations.
 */

import { createHash } from "crypto";
import { defaultJobQueue } from "./queue/queue";
import {
  CreateJobDTO,
  UpdateJobDTO,
  CreateAutomationDTO,
  UpdateAutomationDTO,
  Job,
  JobRun,
  Automation,
} from "./types";

export class JobEngine {
  /**
   * Genera un hash determinista SHA-256 de la configuración del job.
   */
  public computeConfigurationHash(params: {
    agentId: string;
    name: string;
    input: string;
    timeoutSeconds: number;
    maxConcurrentRuns: number;
    retryPolicy: Record<string, any>;
  }): string {
    const canonicalPayload = JSON.stringify({
      agentId: params.agentId,
      input: params.input.trim(),
      maxConcurrentRuns: params.maxConcurrentRuns,
      name: params.name.trim(),
      retryPolicy: params.retryPolicy,
      timeoutSeconds: params.timeoutSeconds,
    });

    return createHash("sha256").update(canonicalPayload).digest("hex");
  }

  /**
   * Crea un nuevo Job duradero con versionado inicial.
   */
  public async createJob(
    workspaceId: string,
    userId: string,
    dto: CreateJobDTO,
    supabase: any
  ): Promise<Job> {
    const timeoutSeconds = dto.timeout_seconds || 300;
    const maxConcurrentRuns = dto.max_concurrent_runs || 1;
    const retryPolicy = {
      max_attempts: dto.retry_policy?.max_attempts ?? 3,
      initial_delay_seconds: dto.retry_policy?.initial_delay_seconds ?? 10,
      max_delay_seconds: dto.retry_policy?.max_delay_seconds ?? 300,
      backoff_factor: dto.retry_policy?.backoff_factor ?? 2.0,
      jitter: dto.retry_policy?.jitter ?? true,
    };

    const configHash = this.computeConfigurationHash({
      agentId: dto.agent_id,
      name: dto.name,
      input: dto.input,
      timeoutSeconds,
      maxConcurrentRuns,
      retryPolicy,
    });

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        workspace_id: workspaceId,
        agent_id: dto.agent_id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        input: dto.input.trim(),
        status: "draft",
        trigger_type: dto.trigger_type || "manual",
        timeout_seconds: timeoutSeconds,
        max_concurrent_runs: maxConcurrentRuns,
        retry_policy: retryPolicy,
        configuration_version: 1,
        configuration_hash: configHash,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Job;
  }

  /**
   * Actualiza la configuración de un Job y computa una nueva versión de hash si cambia.
   */
  public async updateJob(
    jobId: string,
    workspaceId: string,
    dto: UpdateJobDTO,
    supabase: any
  ): Promise<Job> {
    const { data: currentJob, error: getErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .single();

    if (getErr || !currentJob) throw new Error("Job no encontrado.");

    const name = dto.name !== undefined ? dto.name.trim() : currentJob.name;
    const description = dto.description !== undefined ? dto.description?.trim() || null : currentJob.description;
    const input = dto.input !== undefined ? dto.input.trim() : currentJob.input;
    const timeoutSeconds = dto.timeout_seconds !== undefined ? dto.timeout_seconds : currentJob.timeout_seconds;
    const maxConcurrentRuns = dto.max_concurrent_runs !== undefined ? dto.max_concurrent_runs : currentJob.max_concurrent_runs;
    const retryPolicy = dto.retry_policy !== undefined ? { ...currentJob.retry_policy, ...dto.retry_policy } : currentJob.retry_policy;

    const newHash = this.computeConfigurationHash({
      agentId: currentJob.agent_id,
      name,
      input,
      timeoutSeconds,
      maxConcurrentRuns,
      retryPolicy,
    });

    const versionChanged = newHash !== currentJob.configuration_hash;
    const newVersion = versionChanged ? currentJob.configuration_version + 1 : currentJob.configuration_version;

    const { data, error } = await supabase
      .from("jobs")
      .update({
        name,
        description,
        input,
        timeout_seconds: timeoutSeconds,
        max_concurrent_runs: maxConcurrentRuns,
        retry_policy: retryPolicy,
        configuration_version: newVersion,
        configuration_hash: newHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as Job;
  }

  /**
   * Transiciona el estado de un job (active, paused, archived).
   */
  public async setJobStatus(
    jobId: string,
    workspaceId: string,
    status: "active" | "paused" | "archived",
    supabase: any
  ): Promise<Job> {
    const { data, error } = await supabase
      .from("jobs")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as Job;
  }

  /**
   * Dispara una ejecución manual inmediata de un job encolándolo en la cola durable.
   */
  public async triggerManualRun(
    jobId: string,
    workspaceId: string,
    userId: string,
    supabase: any
  ): Promise<JobRun> {
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .single();

    if (jobErr || !job) throw new Error("Job no encontrado o sin acceso.");
    if (job.status !== "active") {
      throw new Error(`El job está en estado '${job.status}'. Solo jobs activos pueden ejecutarse.`);
    }

    return defaultJobQueue.enqueue(
      {
        workspaceId,
        jobId: job.id,
        agentId: job.agent_id,
        input: job.input,
        priority: "normal",
        configurationVersion: job.configuration_version,
        configurationHash: job.configuration_hash,
      },
      supabase
    );
  }

  /**
   * Crea una nueva Automation vinculada a un Job.
   */
  public async createAutomation(
    workspaceId: string,
    userId: string,
    dto: CreateAutomationDTO,
    supabase: any
  ): Promise<Automation> {
    const { data, error } = await supabase
      .from("automations")
      .insert({
        workspace_id: workspaceId,
        job_id: dto.job_id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        cron_expression: dto.cron_expression.trim(),
        timezone: dto.timezone || "UTC",
        concurrency_policy: dto.concurrency_policy || "forbid",
        catch_up_policy: dto.catch_up_policy || "limited_catch_up",
        max_catch_up_occurrences: dto.max_catch_up_occurrences || 2,
        status: "draft",
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Automation;
  }

  /**
   * Actualiza el estado de una Automation (active, paused, archived).
   */
  public async setAutomationStatus(
    automationId: string,
    workspaceId: string,
    status: "active" | "paused" | "archived",
    supabase: any
  ): Promise<Automation> {
    const { data, error } = await supabase
      .from("automations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", automationId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as Automation;
  }
}

export const defaultJobEngine = new JobEngine();
