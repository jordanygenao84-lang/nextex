/**
 * NEXTEХ Agent Core — Códigos de error canónicos y excepciones (Fase 4.4)
 */

export const AgentErrorCodes = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_NOT_ACTIVE: "AGENT_NOT_ACTIVE",
  AGENT_PERMISSION_DENIED: "AGENT_PERMISSION_DENIED",
  AGENT_LIMIT_EXCEEDED: "AGENT_LIMIT_EXCEEDED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  AGENT_CANCELLED: "AGENT_CANCELLED",
  AGENT_EXECUTION_BLOCKED: "AGENT_EXECUTION_BLOCKED",
  AGENT_CONCURRENCY_LIMIT: "AGENT_CONCURRENCY_LIMIT",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_DISABLED: "TOOL_DISABLED",
  TOOL_VERSION_UNSUPPORTED: "TOOL_VERSION_UNSUPPORTED",
  TOOL_SCHEMA_INVALID: "TOOL_SCHEMA_INVALID",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  TOOL_APPROVAL_REQUIRED: "TOOL_APPROVAL_REQUIRED",
  TOOL_APPROVAL_INVALID: "TOOL_APPROVAL_INVALID",
  TOOL_APPROVAL_REPLAY: "TOOL_APPROVAL_REPLAY",
  TOOL_APPROVAL_UNAUTHORIZED: "TOOL_APPROVAL_UNAUTHORIZED",
  TOOL_SELF_APPROVAL_BLOCKED: "TOOL_SELF_APPROVAL_BLOCKED",
  TOOL_RISK_VIOLATION: "TOOL_RISK_VIOLATION",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TOOL_FENCING_REJECTED: "TOOL_FENCING_REJECTED",
  TOOL_LEASE_EXPIRED: "TOOL_LEASE_EXPIRED",
  TOOL_PAYLOAD_HASH_MISMATCH: "TOOL_PAYLOAD_HASH_MISMATCH",
  TOOL_IDEMPOTENCY_CONFLICT: "TOOL_IDEMPOTENCY_CONFLICT",
  TOOL_UNAUTHORIZED_MUTATION: "TOOL_UNAUTHORIZED_MUTATION",
  TOOL_CROSS_TENANT_ACCESS: "TOOL_CROSS_TENANT_ACCESS",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: "INSUFFICIENT_ADMINISTRATIVE_HIERARCHY",
  INVALID_AGENT_DATA: "INVALID_AGENT_DATA",
  INTERNAL_AGENT_ERROR: "INTERNAL_AGENT_ERROR",
} as const;

export type AgentErrorCode = (typeof AgentErrorCodes)[keyof typeof AgentErrorCodes];

export interface AgentErrorDetails {
  code: AgentErrorCode;
  message: string;
  statusCode: number;
  agentId?: string;
  runId?: string;
  toolId?: string;
  retryable?: boolean;
}

export class AgentError extends Error {
  public readonly code: AgentErrorCode;
  public readonly statusCode: number;
  public readonly agentId?: string;
  public readonly runId?: string;
  public readonly toolId?: string;
  public readonly retryable: boolean;

  constructor(details: AgentErrorDetails) {
    super(details.message);
    this.name = "AgentError";
    this.code = details.code;
    this.statusCode = details.statusCode;
    this.agentId = details.agentId;
    this.runId = details.runId;
    this.toolId = details.toolId;
    this.retryable = details.retryable ?? false;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentError);
    }
  }

  public toJSON(): AgentErrorDetails {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      agentId: this.agentId,
      runId: this.runId,
      toolId: this.toolId,
      retryable: this.retryable,
    };
  }
}
