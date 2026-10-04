/**
 * NEXTEХ Observability — Métricas Operacionales de Baja Cardinalidad
 * Fase 4.8: Conteo y cálculo de percentiles con control estricto de labels.
 */

import { ObservabilitySpan } from "./types";

const ALLOWED_METRIC_LABELS = new Set([
  "component",
  "status",
  "span_type",
  "error_category",
  "provider",
  "model",
  "operation",
]);

export interface MetricEntry {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  labels: Record<string, string>;
  timestamp: string;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private entries: MetricEntry[] = [];

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Filtra labels para garantizar baja cardinalidad.
   */
  private sanitizeLabels(labels?: Record<string, string>): Record<string, string> {
    if (!labels) return {};
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (ALLOWED_METRIC_LABELS.has(k) && typeof v === "string") {
        sanitized[k] = v.slice(0, 50); // Máximo 50 caracteres por valor de label
      }
    }
    return sanitized;
  }

  public increment(name: string, value = 1, labels?: Record<string, string>): void {
    this.entries.push({
      name,
      type: "counter",
      value,
      labels: this.sanitizeLabels(labels),
      timestamp: new Date().toISOString(),
    });

    if (this.entries.length > 2000) {
      this.entries.shift();
    }
  }

  public gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.entries.push({
      name,
      type: "gauge",
      value,
      labels: this.sanitizeLabels(labels),
      timestamp: new Date().toISOString(),
    });

    if (this.entries.length > 2000) {
      this.entries.shift();
    }
  }

  public histogram(name: string, durationMs: number, labels?: Record<string, string>): void {
    this.entries.push({
      name,
      type: "histogram",
      value: durationMs,
      labels: this.sanitizeLabels(labels),
      timestamp: new Date().toISOString(),
    });

    if (this.entries.length > 2000) {
      this.entries.shift();
    }
  }

  public getSnapshot(): MetricEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries = [];
  }

  /**
   * Calcula agregaciones consolidadas a partir de una lista de spans.
   */
  public static calculateAggregates(spans: ObservabilitySpan[]) {
    const totalSpans = spans.length;
    let completedCount = 0;
    let failedCount = 0;
    let totalDurationMs = 0;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;

    const components = new Set<string>();
    const errorCategories: Record<string, number> = {};

    for (const span of spans) {
      components.add(span.component);

      if (span.status === "completed") {
        completedCount++;
      } else if (span.status === "failed") {
        failedCount++;
        const cat = span.error_category || "SYSTEM";
        errorCategories[cat] = (errorCategories[cat] || 0) + 1;
      }

      if (typeof span.duration_ms === "number") {
        totalDurationMs += span.duration_ms;
      }

      if (span.attributes?.tokens_input && typeof span.attributes.tokens_input === "number") {
        totalTokensInput += span.attributes.tokens_input;
      }
      if (span.attributes?.tokens_output && typeof span.attributes.tokens_output === "number") {
        totalTokensOutput += span.attributes.tokens_output;
      }
    }

    const successRate = totalSpans > 0 ? (completedCount / totalSpans) * 100 : 100;
    const avgDurationMs = totalSpans > 0 ? Math.round(totalDurationMs / totalSpans) : 0;

    return {
      totalSpans,
      completedCount,
      failedCount,
      successRate,
      avgDurationMs,
      totalTokensInput,
      totalTokensOutput,
      totalTokens: totalTokensInput + totalTokensOutput,
      componentsCount: components.size,
      errorCategories,
    };
  }
}

export const metrics = MetricsCollector.getInstance();
