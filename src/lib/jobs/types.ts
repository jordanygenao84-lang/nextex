/**
 * NEXTEХ Durable Jobs & Automation — Tipos e interfaces formales (Fase 4.6)
 * Contrato cerrado de entidades, cola, programación, workers, leases y auditoría.
 */

export type JobStatus = "draft" | "active" | "paused" | "archived";
export type JobTriggerType = "manual" | "scheduled" | "webhook";

export interface JobRetryPolicy {
  max_attempts: number;
  initial_delay_seconds: number;
  max_delay_seconds: number;
  backoff_factor: number;
  jitter: boolean;
}

export interface Job {
  id: string;
  workspace_id: string;
  agent_id: string;
  name: string;
  description: string | null;
  input: string; // Untrusted user data
  status: JobStatus;
  trigger_type: JobTriggerType;
  timeout_seconds: number;
  max_concurrent_runs: number;
  retry_policy: JobRetryPolicy;
  configuration_version: number;
  configuration_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type AutomationStatus = "draft" | "active" | "paused" | "archived";
export type ConcurrencyPolicy = "allow" | "forbid" | "queue";
export type CatchUpPolicy = "skip" | "catch_up" | "limited_catch_up";

export interface Automation {
  id: string;
  workspace_id: string;
  job_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  concurrency_policy: ConcurrencyPolicy;
  catch_up_policy: CatchUpPolicy;
  max_catch_up_occurrences: number;
  status: AutomationStatus;
  last_scheduled_at: string | null;
  next_scheduled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type OccurrenceStatus = "pending" | "spawned" | "skipped" | "missed";

export interface ScheduleOccurrence {
  id: string;
  workspace_id: string;
  automation_id: string;
  job_id: string;
  scheduled_for: string;
  status: OccurrenceStatus;
  job_run_id: string | null;
  skip_reason: string | null;
  created_at: string;
}

export type JobRunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_approval"
  | "cancellation_requested"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "dead_letter";

export type JobRunPriority = "low" | "normal" | "high";

export interface JobRun {
  id: string;
  workspace_id: string;
  job_id: string;
  automation_id: string | null;
  occurrence_id: string | null;
  event_id?: string | null;
  agent_id: string;
  agent_run_id: string | null;
  priority: JobRunPriority;
  status: JobRunStatus;
  input: string;
  output: string | null;
  attempt: number;
  max_attempts: number;
  retry_of_run_id: string | null;
  fencing_token: number | bigint;
  worker_id: string | null;
  lease_expires_at: string | null;
  configuration_version: number;
  configuration_hash: string;
  tokens_input: number;
  tokens_output: number;
  total_tokens: number;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type JobAuditActorType = "user" | "worker" | "scheduler" | "system";

export interface JobAuditLogEntry {
  id: string;
  workspace_id: string;
  job_id: string;
  job_run_id: string | null;
  actor_type: JobAuditActorType;
  actor_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  fencing_token: number | bigint | null;
  worker_id: string | null;
  details: Record<string, any>;
  created_at: string;
}

// Clasificación de reintento de inferencia externa
export type AIRetrySemantic = "AI_RETRY_DEDUPED" | "AI_RETRY_REEXECUTED" | "AI_RETRY_UNCERTAIN";

// DTOs para Creación y Actualización
export interface CreateJobDTO {
  agent_id: string;
  name: string;
  description?: string | null;
  input: string;
  trigger_type?: JobTriggerType;
  timeout_seconds?: number;
  max_concurrent_runs?: number;
  retry_policy?: Partial<JobRetryPolicy>;
}

export interface UpdateJobDTO {
  name?: string;
  description?: string | null;
  input?: string;
  timeout_seconds?: number;
  max_concurrent_runs?: number;
  retry_policy?: Partial<JobRetryPolicy>;
}

export interface CreateAutomationDTO {
  job_id: string;
  name: string;
  description?: string | null;
  cron_expression: string;
  timezone?: string;
  concurrency_policy?: ConcurrencyPolicy;
  catch_up_policy?: CatchUpPolicy;
  max_catch_up_occurrences?: number;
}

export interface UpdateAutomationDTO {
  name?: string;
  description?: string | null;
  cron_expression?: string;
  timezone?: string;
  concurrency_policy?: ConcurrencyPolicy;
  catch_up_policy?: CatchUpPolicy;
  max_catch_up_occurrences?: number;
}
