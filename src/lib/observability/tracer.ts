/**
 * NEXTEХ Observability — Cliente de Trazabilidad y Emisión Fail-Safe
 * Fase 4.8: Registro resiliente de spans sin acoplamiento a la transacción de negocio.
 */

import { createClient } from "@supabase/supabase-js";
import { ObservabilityContext, generateSpanId, generateTraceId } from "./context";
import { boundSpanAttributes } from "./sanitizer";
import { ObservabilityErrorClassifier } from "./errors";
import {
  ObservabilitySpan,
  SpanAttributes,
  SpanStatus,
  SpanType,
  TraceContext,
} from "./types";

export interface StartSpanOptions {
  name: string;
  component: string;
  spanType: SpanType;
  workspaceId?: string;
  parentSpanId?: string | null;
  attributes?: SpanAttributes;
  jobId?: string | null;
  jobRunId?: string | null;
  agentId?: string | null;
  agentRunId?: string | null;
  agentStepId?: string | null;
  integrationId?: string | null;
  integrationEventId?: string | null;
  approvalRequestId?: string | null;
  aiRequestId?: string | null;
  toolId?: string | null;
}

export interface EndSpanOptions {
  status?: SpanStatus;
  error?: unknown;
  attributes?: SpanAttributes;
}

export class ActiveSpan {
  private span: ObservabilitySpan;
  private tracer: ObservabilityTracer;
  private isEnded = false;

  constructor(span: ObservabilitySpan, tracer: ObservabilityTracer) {
    this.span = span;
    this.tracer = tracer;
  }

  public get spanId(): string {
    return this.span.span_id;
  }

  public get traceId(): string {
    return this.span.trace_id;
  }

  public get data(): ObservabilitySpan {
    return { ...this.span };
  }

  public setAttribute(key: string, value: unknown): this {
    if (!this.span.attributes) {
      this.span.attributes = {};
    }
    this.span.attributes[key] = value;
    return this;
  }

  public setAttributes(attrs: SpanAttributes): this {
    if (!this.span.attributes) {
      this.span.attributes = {};
    }
    Object.assign(this.span.attributes, attrs);
    return this;
  }

  public async end(options?: EndSpanOptions): Promise<void> {
    if (this.isEnded) return;
    this.isEnded = true;

    const completedAt = new Date();
    const startedAt = new Date(this.span.started_at);
    this.span.completed_at = completedAt.toISOString();
    this.span.duration_ms = Math.max(0, completedAt.getTime() - startedAt.getTime());

    if (options?.status) {
      this.span.status = options.status;
    } else if (options?.error) {
      this.span.status = "failed";
    } else {
      this.span.status = "completed";
    }

    if (options?.error) {
      const errDetails = ObservabilityErrorClassifier.classify(options.error);
      this.span.error_code = errDetails.errorCode;
      this.span.error_category = errDetails.errorCategory;
      this.span.error_message_safe = errDetails.errorMessageSafe;
    }

    if (options?.attributes) {
      this.setAttributes(options.attributes);
    }

    // Sanitizar atributos en Capa 1
    this.span.attributes = boundSpanAttributes(this.span.attributes);

    // Enviar a persistencia mediante fail-safe
    await this.tracer.recordSpan(this.span);
  }
}

export class ObservabilityTracer {
  private static instance: ObservabilityTracer;
  private inMemorySpans: ObservabilitySpan[] = [];
  private supabaseClient: any = null;

  public constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && serviceKey) {
      this.supabaseClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  public static getInstance(): ObservabilityTracer {
    if (!ObservabilityTracer.instance) {
      ObservabilityTracer.instance = new ObservabilityTracer();
    }
    return ObservabilityTracer.instance;
  }

  /**
   * Inicia un nuevo span vinculado al contexto actual.
   */
  public startSpan(options: StartSpanOptions): ActiveSpan {
    const ctx = ObservabilityContext.current();
    const traceId = ctx?.traceId || generateTraceId();
    const spanId = generateSpanId();
    const parentSpanId = options.parentSpanId !== undefined ? options.parentSpanId : ctx?.spanId || null;
    const workspaceId = options.workspaceId || ctx?.workspaceId || "00000000-0000-0000-0000-000000000000";

    const span: ObservabilitySpan = {
      workspace_id: workspaceId,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      span_type: options.spanType,
      operation: options.name,
      component: options.component,
      status: "started",
      started_at: new Date().toISOString(),
      job_id: options.jobId,
      job_run_id: options.jobRunId,
      agent_id: options.agentId,
      agent_run_id: options.agentRunId,
      agent_step_id: options.agentStepId,
      integration_id: options.integrationId,
      integration_event_id: options.integrationEventId,
      approval_request_id: options.approvalRequestId,
      ai_request_id: options.aiRequestId,
      tool_id: options.toolId,
      attributes: boundSpanAttributes(options.attributes),
    };

    return new ActiveSpan(span, this);
  }

  /**
   * Wrapper declarativo que ejecuta una función dentro de un Span y un Contexto de traza.
   */
  public async trace<T>(
    options: StartSpanOptions,
    fn: (span: ActiveSpan) => Promise<T> | T
  ): Promise<T> {
    const span = this.startSpan(options);
    const traceContext: TraceContext = {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: options.parentSpanId !== undefined ? options.parentSpanId || undefined : undefined,
      workspaceId: span.data.workspace_id,
    };

    return ObservabilityContext.run(traceContext, async () => {
      try {
        const result = await fn(span);
        await span.end({ status: "completed" });
        return result;
      } catch (error) {
        await span.end({ status: "failed", error });
        throw error;
      }
    });
  }

  /**
   * Persiste el span de forma estrictamente FAIL-SAFE.
   * Si la escritura falla por red o DB, jamás eleva la excepción a la lógica de negocio.
   */
  public async recordSpan(span: ObservabilitySpan): Promise<void> {
    // Almacenar en buffer en memoria para pruebas y diagnóstico local
    this.inMemorySpans.push(span);
    if (this.inMemorySpans.length > 500) {
      this.inMemorySpans.shift();
    }

    if (!this.supabaseClient) {
      return;
    }

    try {
      // Intentar inserción vía RPC atómica o tabla directa
      const { error } = await this.supabaseClient.rpc("record_observability_spans_batch", {
        p_spans: [span],
      });

      if (error) {
        // Fallback a insert directo si la RPC no estuviese aún cargada en cache
        const { error: directError } = await this.supabaseClient
          .from("observability_spans")
          .insert(span);

        if (directError) {
          // Log local seguro sin romper la operación
          // (No lanzar excepción)
        }
      }
    } catch {
      // Fail-safe: Absorber error y no romper el flujo de negocio
    }
  }

  /**
   * Obtiene spans registrados en memoria (útil para tests unitarios).
   */
  public getInMemorySpans(): ObservabilitySpan[] {
    return [...this.inMemorySpans];
  }

  /**
   * Limpia el buffer en memoria.
   */
  public clearInMemorySpans(): void {
    this.inMemorySpans = [];
  }
}

export const tracer = ObservabilityTracer.getInstance();
