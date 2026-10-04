/**
 * NEXTEХ (Nexora Texter) — Control Plane Formal Types & Contracts (Fase 4.10)
 * Definición estricta de entidades de workers, leases, auditoría, errores y DTOs.
 */

export type WorkerStatus =
  | "STARTING"
  | "HEALTHY"
  | "DRAINING"
  | "STOPPED"
  | "STALE"
  | "QUARANTINED";

export type WorkerCapability =
  | "ai"
  | "database"
  | "integrations"
  | "http"
  | "browser"
  | "files"
  | "code_execution"
  | string;

export interface Worker {
  id: string;
  workspace_id: string;
  worker_identity: string;
  instance_identity: string;
  status: WorkerStatus;
  version: string;
  capabilities: WorkerCapability[];
  max_concurrency: number;
  current_concurrency: number;
  last_heartbeat_at: string;
  registered_at: string;
  draining_at: string | null;
  stopped_at: string | null;
  quarantined_at: string | null;
  quarantine_reason: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type WorkerLeaseStatus = "active" | "released" | "expired" | "revoked";

export interface WorkerLease {
  id: string;
  worker_id: string;
  workspace_id: string;
  job_run_id: string;
  fencing_token: bigint | number;
  leased_at: string;
  expires_at: string;
  released_at: string | null;
  status: WorkerLeaseStatus;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type WorkerAuditAction =
  | "WORKER_REGISTERED"
  | "WORKER_HEARTBEAT_ANOMALY"
  | "WORKER_DRAIN_REQUESTED"
  | "WORKER_DRAINED"
  | "WORKER_STOPPED"
  | "WORKER_QUARANTINED"
  | "WORKER_RELEASED"
  | "WORKER_RECOVERED"
  | "JOB_DISPATCHED"
  | "JOB_CLAIMED"
  | "JOB_REQUEUED"
  | "JOB_CANCEL_REQUESTED";

export interface WorkerAuditLogEntry {
  id: string;
  workspace_id: string;
  worker_id: string | null;
  actor_type: "user" | "worker" | "dispatcher" | "system";
  actor_id: string;
  action: WorkerAuditAction;
  previous_status: string | null;
  new_status: string | null;
  details: Record<string, any>;
  created_at: string;
}

// ==============================================================================
// ERROR CLASSIFICATION SYSTEM
// ==============================================================================

export type ControlPlaneErrorCode =
  | "TRANSIENT"
  | "RETRYABLE"
  | "PERMANENT"
  | "FENCING"
  | "AUTHORIZATION"
  | "CAPACITY"
  | "QUARANTINE"
  | "CANCELLATION"
  | "UNKNOWN";

export class ControlPlaneError extends Error {
  public readonly code: ControlPlaneErrorCode;
  public readonly rawError?: any;
  public readonly isRetryable: boolean;

  constructor(message: string, code: ControlPlaneErrorCode, rawError?: any) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
    this.rawError = rawError;
    this.isRetryable = code === "TRANSIENT" || code === "RETRYABLE";
  }

  public static classify(err: any): ControlPlaneError {
    if (err instanceof ControlPlaneError) return err;

    const msg = String(err?.message || err?.error_message || err || "").toLowerCase();
    const code = String(err?.code || err?.error_code || "").toUpperCase();

    if (code === "WORKER_QUARANTINED" || msg.includes("cuarentena") || msg.includes("quarantined")) {
      return new ControlPlaneError("Worker en cuarentena operativa", "QUARANTINE", err);
    }
    if (code === "FENCING_REJECTED" || msg.includes("fencing") || msg.includes("desfasado")) {
      return new ControlPlaneError("Fencing token rechazado o desfasado", "FENCING", err);
    }
    if (code === "UNAUTHORIZED_WORKSPACE" || code === "AUTH_REQUIRED" || msg.includes("denegado") || msg.includes("unauthorized")) {
      return new ControlPlaneError("Violación de autorización o frontera de tenant", "AUTHORIZATION", err);
    }
    if (code === "CAPACITY_EXCEEDED" || msg.includes("capacity") || msg.includes("concurrencia")) {
      return new ControlPlaneError("Capacidad del control plane excedida", "CAPACITY", err);
    }
    if (code === "JOB_CANCEL_REQUESTED" || code === "ALREADY_TERMINAL" || msg.includes("cancell")) {
      return new ControlPlaneError("Operación sobre job cancelado", "CANCELLATION", err);
    }
    if (msg.includes("timeout") || msg.includes("connection") || msg.includes("fetch failed") || msg.includes("econnreset")) {
      return new ControlPlaneError("Fallo de red o timeout transitorio", "TRANSIENT", err);
    }
    if (code === "INVALID_PARAMETERS" || code === "WORKER_NOT_FOUND" || code === "LEASE_NOT_FOUND") {
      return new ControlPlaneError(msg || "Error permanente de solicitud", "PERMANENT", err);
    }

    return new ControlPlaneError(msg || "Error no clasificado del control plane", "UNKNOWN", err);
  }
}

// ==============================================================================
// DTOs & RPC INTERFACES
// ==============================================================================

export interface RegisterWorkerParams {
  workspaceId: string;
  workerIdentity: string;
  instanceIdentity?: string; // Si se omite, se genera una nueva de forma determinista/única
  version?: string;
  capabilities?: WorkerCapability[];
  maxConcurrency?: number;
  metadata?: Record<string, any>;
}

export interface RegisterWorkerResult {
  success: boolean;
  worker?: Worker;
  error_code?: string;
  error_message?: string;
}

export interface HeartbeatWorkerResult {
  success: boolean;
  status?: WorkerStatus;
  current_concurrency?: number;
  last_heartbeat_at?: string;
  error_code?: string;
  error_message?: string;
}

export interface DrainWorkerResult {
  success: boolean;
  status?: WorkerStatus;
  active_leases?: number;
  error_code?: string;
  error_message?: string;
}

export interface QuarantineWorkerResult {
  success: boolean;
  status?: WorkerStatus;
  revoked_leases?: number;
  error_code?: string;
  error_message?: string;
}

export interface ReleaseQuarantineResult {
  success: boolean;
  status?: WorkerStatus;
  error_code?: string;
  error_message?: string;
}

export interface ClaimJobV2Params {
  workerId: string;
  leaseSeconds?: number;
  requiredCapabilities?: WorkerCapability[];
}

export interface ClaimJobV2Result {
  success: boolean;
  claimed: boolean;
  run?: any;
  lease?: WorkerLease;
  message?: string;
  status?: string;
  error_code?: string;
  error_message?: string;
}

export interface ReleaseWorkerLeaseParams {
  leaseId: string;
  workerId: string;
  fencingToken: bigint | number;
}

export interface ReleaseWorkerLeaseResult {
  success: boolean;
  released?: boolean;
  already_released?: boolean;
  status?: string;
  error_code?: string;
  error_message?: string;
}

export interface RequestJobCancellationParams {
  jobRunId: string;
  actorId: string;
  reason?: string;
}

export interface RequestJobCancellationResult {
  success: boolean;
  status?: string;
  error_code?: string;
  error_message?: string;
}

export interface RecoverWorkerJobsParams {
  batchSize?: number;
}

export interface RecoverWorkerJobsResult {
  success: boolean;
  recovered_count: number;
  error_code?: string;
  error_message?: string;
}

// ==============================================================================
// DISPATCHER TYPES
// ==============================================================================

export type DispatcherStatus = "IDLE" | "POLLING" | "DISPATCHING" | "BACKOFF" | "STOPPED";

export interface DispatcherConfig {
  workspaceId: string;
  dispatcherId?: string;
  pollIntervalMs?: number; // Base poll interval (default 1000ms)
  maxPollIntervalMs?: number; // Max exponential backoff (default 15000ms)
  maxClaimsPerTick?: number; // Max batch claims per tick (default 5)
  claimLeaseSeconds?: number; // Lease duration in seconds (default 60)
  jitterRatio?: number; // Random jitter ratio 0.0-0.5 (default 0.2)
}

export interface DispatchMetrics {
  cyclesTotal: number;
  claimsAttempted: number;
  claimsSucceeded: number;
  claimsRejected: number;
  emptyPollsCount: number;
  errorsCount: number;
  lastCycleAt: string | null;
  lastClaimAt: string | null;
  consecutiveEmptyPolls: number;
}

export interface JobRunDispatchEvent {
  jobRun: any;
  lease: WorkerLease;
  worker: Worker;
  fencingToken: bigint | number;
  dispatchedAt: string;
}

// ==============================================================================
// WORKER RUNTIME TYPES (Fase 4.10-E)
// ==============================================================================

export interface WorkerRuntimeConfig {
  workspaceId: string;
  workerIdentity: string;
  instanceIdentity?: string;
  version?: string;
  capabilities?: WorkerCapability[];
  maxConcurrency?: number;
  heartbeatIntervalMs?: number;
  metadata?: Record<string, any>;
  supabaseClient?: any;
  agentRuntime?: any;
  jobQueue?: any;
  policyEngine?: any;
  toolExecutor?: any;
}

export interface JobExecutionResult {
  success: boolean;
  status:
    | "completed"
    | "failed"
    | "waiting_approval"
    | "cancelled"
    | "checkpoint_requeued"
    | "retry_scheduled";
  runId: string;
  fencingToken: bigint | number;
  output?: any;
  error?: string;
  errorCode?: string;
  isRetryable?: boolean;
}

// ==============================================================================
// RECOVERY & FAULT TOLERANCE TYPES (Fase 4.10-F)
// ==============================================================================

export type RecoveryEventType =
  | "worker_stale"
  | "lease_expired"
  | "job_recovery_started"
  | "job_recovery_claimed"
  | "job_recovery_rejected"
  | "zombie_execution_rejected"
  | "agent_run_recovered"
  | "agent_step_recovered"
  | "recovery_completed"
  | "recovery_failed"
  | "cancellation_requested";

export interface RecoveryAuditEntry {
  id?: string;
  workspaceId: string;
  jobRunId?: string;
  agentRunId?: string;
  workerId?: string;
  action: RecoveryEventType;
  previousStatus?: string;
  newStatus?: string;
  fencingToken?: bigint | number;
  details?: Record<string, any>;
  timestamp?: string;
}

export interface RecoveryCycleResult {
  success: boolean;
  recoveredJobsCount: number;
  staleWorkersCount: number;
  details?: Record<string, any>;
  error?: string;
}

export interface ValidateRecoveryOrderingParams {
  workspaceId: string;
  worker: Worker;
  lease: WorkerLease;
  fencingToken: bigint | number;
  jobRun: any;
  agent?: any;
  policy?: any;
  steps?: any[];
}

export interface ValidateRecoveryOrderingResult {
  valid: boolean;
  barrierFailed?:
    | "tenant_authorization"
    | "worker_authority"
    | "lease_authority"
    | "fencing_authority"
    | "job_state"
    | "agent_authority"
    | "step_lineage";
  error?: ControlPlaneError;
}

export interface RecoveryManagerConfig {
  workspaceId?: string;
  supabaseClient?: any;
  registry?: any;
  staleThresholdSeconds?: number;
}

// ==============================================================================
// CANCELLATION, DRAINING & CONTROL-PLANE SHUTDOWN TYPES (Fase 4.10-G)
// ==============================================================================

export type CancellationSource =
  | "user"
  | "workspace"
  | "automation"
  | "job"
  | "job_run"
  | "worker_shutdown"
  | "control_plane_admin";

export type CancellationStatus =
  | "cancellation_requested"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "waiting_approval";

export interface RequestCancellationParams {
  workspaceId: string;
  jobRunId?: string;
  jobId?: string;
  automationId?: string;
  source: CancellationSource;
  actorId?: string;
  actorType?: "user" | "system" | "admin" | "worker";
  reason?: string;
  correlationId?: string;
}

export interface CancellationResult {
  success: boolean;
  jobRunId?: string;
  status: CancellationStatus | string;
  affectedRunsCount: number;
  message?: string;
  error_code?: string;
}

export interface ShutdownSequenceParams {
  workspaceId?: string;
  timeoutMs?: number;
  reason?: string;
  actorId?: string;
  correlationId?: string;
}

export interface ShutdownStepResult {
  step: number;
  name: string;
  status: "completed" | "skipped" | "failed";
  details?: Record<string, any>;
}

export interface ShutdownResult {
  success: boolean;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  steps: ShutdownStepResult[];
  drainedWorkersCount: number;
  recoveredJobsCount: number;
  releasedLeasesCount: number;
  timestamp: string;
}

// ==============================================================================
// GOVERNANCE & AUDIT TYPES (Fase 4.10-H)
// ==============================================================================

export type ControlPlaneDecision =
  | "allow"
  | "deny"
  | "requires_approval"
  | "blocked"
  | "expired";

export type GovernanceActorType =
  | "user"
  | "system"
  | "worker"
  | "dispatcher"
  | "agent"
  | "service";

export type GovernanceResourceType =
  | "workspace"
  | "automation"
  | "job"
  | "job_run"
  | "worker"
  | "agent"
  | "agent_run"
  | "agent_step"
  | "tool"
  | "approval"
  | "cancellation"
  | "recovery"
  | "shutdown"
  | "audit";

export type GovernanceFailureCode =
  | "AUTHORIZATION_DENIED"
  | "TENANT_MISMATCH"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_NOT_ACTIVE"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "FENCING_REJECTED"
  | "LEASE_EXPIRED"
  | "ALREADY_TERMINAL"
  | "DUPLICATE_REQUEST"
  | "AUDIT_WRITE_FAILED";

export interface AuditEvent {
  event_id: string;
  workspace_id: string;
  actor_id: string;
  actor_type: GovernanceActorType;
  action: string;
  resource_type: GovernanceResourceType;
  resource_id: string;
  decision: ControlPlaneDecision;
  reason?: string;
  correlation_id?: string;
  trace_id?: string;
  fencing_token?: bigint | number | string;
  idempotency_key?: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface GovernanceEvaluationContext {
  actorId: string;
  actorType: GovernanceActorType;
  workspaceId: string;
  resourceType: GovernanceResourceType;
  resourceId: string;
  action: string;
  permission?: string;
  role?: string;
  targetWorkspaceId?: string;
  targetResource?: any;
  capabilities?: string[];
  requiredCapabilities?: string[];
  correlationId?: string;
  traceId?: string;
  fencingToken?: bigint | number;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

export interface GovernanceDecisionResult {
  decision: ControlPlaneDecision;
  allowed: boolean;
  errorCode?: GovernanceFailureCode;
  reason: string;
  actorId: string;
  actorType: GovernanceActorType;
  workspaceId: string;
  resourceType: GovernanceResourceType;
  resourceId: string;
  action: string;
  permission?: string;
  fencingToken?: bigint | number;
  correlationId?: string;
  traceId?: string;
  timestamp: string;
}

export interface EvaluateApprovalParams {
  workspaceId: string;
  approvalRequestId: string;
  approverId: string;
  requesterId: string;
  approverRole?: string;
  approverPermissions?: string[];
  expectedPayloadHash: string;
  actualPayloadHash: string;
  status: string;
  expiresAt: string;
  isCancellationPending?: boolean;
}


