/**
 * NEXTEХ Agent Core — Tipos e interfaces de agentes, herramientas, ejecuciones y memoria (Fase 4.5)
 */

import { AgentErrorCode } from "./errors";
export type { ToolRiskLevel } from "../tools/types";
import { ToolRiskLevel } from "../tools/types";
export * from "./memory";
import { MemoryScope, MemoryRetrievalMode, MemoryWriteMode } from "./memory";

export type AgentStatus = "draft" | "active" | "paused" | "archived";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  system_instructions: string;
  model_id: string;
  status: AgentStatus;
  max_steps: number;
  max_tokens: number;
  timeout_seconds: number;
  max_tool_calls: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  tools?: string[];
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export interface AgentRun {
  id: string;
  workspace_id: string;
  agent_id: string;
  user_id: string;
  status: AgentRunStatus;
  input: string;
  output: string | null;
  model_id: string;
  tokens_input: number;
  tokens_output: number;
  total_tokens: number;
  steps_count: number;
  tool_calls_count: number;
  started_at: string | null;
  completed_at: string | null;
  error_code: AgentErrorCode | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  job_run_id?: string | null;
  fencing_token?: number | bigint;
  worker_id?: string | null;
}

export type StepType =
  | "AI_REQUEST"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "VALIDATION"
  | "APPROVAL_REQUEST"
  | "FINAL_RESPONSE";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface AgentRunStep {
  id: string;
  run_id: string;
  workspace_id: string;
  step_number: number;
  step_type: StepType;
  status: StepStatus;
  tool_id?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error_code?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  fencing_token?: number | bigint;
  lease_expires_at?: string | null;
  executor_id?: string | null;
}

export interface ToolIdempotencyLedgerEntry {
  id: string;
  workspace_id: string;
  run_id: string;
  step_id: string;
  tool_id: string;
  tool_version: string;
  execution_id: string;
  fencing_token: number | bigint;
  payload_hash: string;
  operation: "insert" | "update" | "delete";
  target_table: "conversations" | "agents";
  target_record_id?: string | null;
  status: "committed" | "not_found" | "already_deleted";
  result: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ==============================================================================
// GOBERNANZA FASE 4.4 & 4.5 — PERMISSIONS, POLICIES, APPROVALS & MEMORY
// ==============================================================================

export type CanonicalPermissionKey =
  | "agents.read"
  | "agents.create"
  | "agents.update"
  | "agents.delete"
  | "agents.activate"
  | "agents.pause"
  | "runs.read"
  | "runs.execute"
  | "runs.cancel"
  | "tools.read"
  | "tools.execute"
  | "tools.execute_read"
  | "tools.execute_write"
  | "tools.execute_external"
  | "tools.execute_destructive"
  | "approvals.read"
  | "approvals.approve"
  | "approvals.reject"
  | "workspace.members.read"
  | "workspace.members.manage"
  | "workspace.settings.read"
  | "workspace.settings.update"
  | "memory.read"
  | "memory.write"
  | "memory.delete"
  | "memory.manage"
  | "jobs.read"
  | "jobs.create"
  | "jobs.update"
  | "jobs.delete"
  | "jobs.activate"
  | "jobs.pause"
  | "jobs.archive"
  | "jobs.run"
  | "automations.read"
  | "automations.create"
  | "automations.update"
  | "automations.delete"
  | "automations.activate"
  | "automations.pause"
  | "automations.archive"
  | "integrations.read"
  | "integrations.create"
  | "integrations.update"
  | "integrations.delete"
  | "integrations.activate"
  | "integrations.pause"
  | "integrations.revoke"
  | "integration_events.read"
  | "integration_events.retry"
  | "integration_events.quarantine"
  | "integration_events.reprocess"
  | "workers.read"
  | "workers.manage"
  | "workers.drain"
  | "workers.quarantine"
  | "workers.restart"
  | "workers.recover"
  | "workers.configure";

export type PermissionCategory =
  | "agents"
  | "runs"
  | "tools"
  | "approvals"
  | "workspace"
  | "memory"
  | "jobs"
  | "automations"
  | "integrations"
  | "integration_events"
  | "workers";

export interface Permission {
  id: string;
  key: CanonicalPermissionKey;
  category: PermissionCategory;
  description: string;
  created_at: string;
}

export type WorkspaceRole = "owner" | "admin" | "member";

export interface RolePermission {
  id: string;
  role: WorkspaceRole;
  permission_key: CanonicalPermissionKey;
  created_at: string;
}

export interface WorkspacePermissionOverride {
  id: string;
  workspace_id: string;
  user_id: string;
  permission_key: CanonicalPermissionKey;
  effect: "allow" | "deny";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ApprovalMode = "automatic" | "required" | "conditional";
export type SelfApprovalMode = "blocked" | "allowed";

export interface AgentPolicy {
  id: string;
  agent_id: string;
  workspace_id: string;
  allow_execution: boolean;
  allowed_tool_risks: ToolRiskLevel[];
  approval_mode: ApprovalMode;
  self_approval_mode: SelfApprovalMode;
  max_concurrent_runs: number;
  memory_enabled?: boolean;
  memory_retrieval_mode?: MemoryRetrievalMode;
  memory_max_tokens?: number;
  memory_similarity_threshold?: number;
  memory_scopes?: MemoryScope[];
  memory_write_mode?: MemoryWriteMode;
  created_at: string;
  updated_at: string;
}

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface ApprovalRequest {
  id: string;
  workspace_id: string;
  run_id: string;
  step_id: string;
  tool_id: string;
  tool_version: string;
  requester_id: string;
  required_permission: CanonicalPermissionKey;
  risk_level: ToolRiskLevel;
  payload_hash: string;
  status: ApprovalStatus;
  approver_id: string | null;
  comment: string | null;
  created_at: string;
  resolved_at: string | null;
  expires_at: string;
}

export interface AuthorizationEvaluationContext {
  userId: string;
  workspaceId: string;
  agentId: string;
  toolId?: string;
  toolVersion?: string;
  params?: Record<string, any>;
  runId?: string;
  stepId?: string;
  targetScope?: MemoryScope;
  targetTrustLevel?: string;
}

export interface AuthorizationDecision {
  decision: "allow" | "deny" | "approval_required";
  reason: string;
  requiredPermission?: CanonicalPermissionKey;
  riskLevel?: ToolRiskLevel;
  selfApprovalAllowed: boolean;
  metadata?: Record<string, any>;
}

export interface AuthorizationAuditLogEntry {
  id: string;
  workspace_id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: "allow" | "deny" | "approval_required";
  reason: string;
  evaluated_role?: string | null;
  evaluated_permissions?: Record<string, boolean> | null;
  agent_id?: string | null;
  run_id?: string | null;
  step_id?: string | null;
  tool_id?: string | null;
  tool_version?: string | null;
  payload_hash?: string | null;
  created_at: string;
}

export interface AgentLimits {
  max_steps: number;
  max_tokens: number;
  timeout_seconds: number;
  max_tool_calls: number;
}

export interface CreateAgentDTO {
  workspace_id: string;
  name: string;
  description?: string;
  system_instructions: string;
  model_id: string;
  status?: AgentStatus;
  max_steps?: number;
  max_tokens?: number;
  timeout_seconds?: number;
  max_tool_calls?: number;
  tool_ids?: string[];
}

export interface UpdateAgentDTO {
  name?: string;
  description?: string;
  system_instructions?: string;
  model_id?: string;
  status?: AgentStatus;
  max_steps?: number;
  max_tokens?: number;
  timeout_seconds?: number;
  max_tool_calls?: number;
  tool_ids?: string[];
}

export interface ExecuteAgentRunDTO {
  agent_id: string;
  workspace_id: string;
  user_id: string;
  input: string;
  override_max_tokens?: number;
  override_timeout_seconds?: number;
  override_max_steps?: number;
  forced_tool_call?: {
    tool_id: string;
    params: Record<string, any>;
  };
  job_run_id?: string;
  fencing_token?: number | bigint;
  worker_id?: string;
}

export interface RunApprovalDTO {
  step_id: string;
  action: "approve" | "reject";
  comment?: string;
}
