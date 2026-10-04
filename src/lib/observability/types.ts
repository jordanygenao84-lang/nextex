/**
 * NEXTEХ Observability — Definiciones de Tipos y Taxonomía Operacional
 * Fase 4.8: Trazabilidad, Telemetría y Diagnóstico Multi-Tenant
 */

export type SpanType =
  | "workflow"
  | "integration"
  | "job"
  | "agent"
  | "step"
  | "tool"
  | "ai"
  | "approval"
  | "system";

export type SpanStatus = "started" | "completed" | "failed" | "cancelled";

export type ErrorCategory =
  | "SYSTEM"
  | "VALIDATION"
  | "SECURITY"
  | "PROVIDER"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "GOVERNANCE"
  | "BUSINESS";

export interface SpanAttributes {
  [key: string]: unknown;
}

export interface ObservabilitySpan {
  id?: string;
  workspace_id: string;

  // Identificadores de Telemetría Internos de NEXTEХ
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;

  // Clasificación
  span_type: SpanType;
  operation: string;
  component: string;
  status: SpanStatus;

  // Tiempos
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;

  // Diagnóstico
  error_code?: string | null;
  error_category?: ErrorCategory | null;
  error_message_safe?: string | null;

  // Correlación de Negocio (Integridad Compuesta)
  job_id?: string | null;
  job_run_id?: string | null;
  agent_id?: string | null;
  agent_run_id?: string | null;
  agent_step_id?: string | null;
  integration_id?: string | null;
  integration_event_id?: string | null;
  approval_request_id?: string | null;
  ai_request_id?: string | null;
  tool_id?: string | null;

  // Atributos Sanitizados (Capa 1 y Capa 2 <= 4096 bytes)
  attributes?: SpanAttributes;

  created_at?: string;
}

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly workspaceId: string;
  readonly userId?: string;
}

export interface ExecutionInterval {
  type: "queue" | "execution" | "approval" | "retry_delay";
  startMs: number;
  endMs: number;
}

export interface TimingBreakdown {
  wallClockDurationMs: number;
  activeExecutionDurationMs: number;
  queueWaitDurationMs: number;
  approvalWaitDurationMs: number;
  retryDelayDurationMs: number;
  intervalsCount: number;
}

export interface TraceSummary {
  traceId: string;
  workspaceId: string;
  rootSpan?: ObservabilitySpan;
  spansCount: number;
  status: SpanStatus;
  startedAt: string;
  completedAt?: string | null;
  timing: TimingBreakdown;
  hasErrors: boolean;
  errorCount: number;
  components: string[];
}

export interface TraceFilterParams {
  workspaceId: string;
  startDate?: string;
  endDate?: string;
  status?: SpanStatus;
  component?: string;
  spanType?: SpanType;
  errorCode?: string;
  jobId?: string;
  agentId?: string;
  integrationId?: string;
  limit?: number;
  offset?: number;
}
