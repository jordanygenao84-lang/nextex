/**
 * NEXTEХ Agent Core — Tipos e interfaces de agentes, herramientas y ejecuciones (Fase 4.2)
 */

import { AgentErrorCode } from "./errors";

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
}

export interface RunApprovalDTO {
  step_id: string;
  action: "approve" | "reject";
  comment?: string;
}
