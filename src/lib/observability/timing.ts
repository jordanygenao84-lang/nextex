/**
 * NEXTEХ Observability — Motor de Tiempos e Intervalos de Ejecución (Corrección 3)
 * Cálculo matemático de duraciones no-lineales, sin suma ciega y con unión de intervalos.
 */

import { ExecutionInterval, ObservabilitySpan, TimingBreakdown } from "./types";

/**
 * Une intervalos solapados o contiguos para evitar el doble conteo de tiempo.
 */
export function mergeIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];

  // Filtrar intervalos inválidos o negativos
  const valid = intervals
    .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end >= iv.start)
    .sort((a, b) => a.start - b.start);

  if (valid.length === 0) return [];

  const merged: Array<{ start: number; end: number }> = [valid[0]];

  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Intervalos solapados o adyacentes -> extender límite superior
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Calcula la suma total de duración de una lista de intervalos tras consolidar solapamientos.
 */
export function sumConsolidatedDuration(intervals: Array<{ start: number; end: number }>): number {
  const merged = mergeIntervals(intervals);
  return merged.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
}

/**
 * Calcula el desglose temporal formal de una traza completa a partir de sus spans.
 */
export function calculateTraceTiming(spans: ObservabilitySpan[]): TimingBreakdown {
  if (!spans || spans.length === 0) {
    return {
      wallClockDurationMs: 0,
      activeExecutionDurationMs: 0,
      queueWaitDurationMs: 0,
      approvalWaitDurationMs: 0,
      retryDelayDurationMs: 0,
      intervalsCount: 0,
    };
  }

  const executionIntervals: Array<{ start: number; end: number }> = [];
  const queueIntervals: Array<{ start: number; end: number }> = [];
  const approvalIntervals: Array<{ start: number; end: number }> = [];
  const retryIntervals: Array<{ start: number; end: number }> = [];

  let minGlobalStart = Infinity;
  let maxGlobalEnd = -Infinity;

  for (const span of spans) {
    const startMs = new Date(span.started_at).getTime();
    if (isNaN(startMs)) continue;

    const endMs = span.completed_at
      ? new Date(span.completed_at).getTime()
      : span.duration_ms
      ? startMs + span.duration_ms
      : startMs;

    minGlobalStart = Math.min(minGlobalStart, startMs);
    maxGlobalEnd = Math.max(maxGlobalEnd, endMs);

    // Clasificar según tipo de operación/span
    if (span.span_type === "approval" || span.operation.includes("waiting_approval")) {
      approvalIntervals.push({ start: startMs, end: endMs });
    } else if (span.operation.includes("queued") || span.operation.includes("queue_wait")) {
      queueIntervals.push({ start: startMs, end: endMs });
    } else if (span.operation.includes("retry_delay") || span.operation.includes("retry_wait")) {
      retryIntervals.push({ start: startMs, end: endMs });
    } else {
      // Spans de ejecución técnica activa (AI, Tool, Worker, Agent, Step)
      executionIntervals.push({ start: startMs, end: endMs });
    }

    // Atributos explícitos adicionales si fueron anotados en el span
    if (span.attributes?.queue_wait_ms && typeof span.attributes.queue_wait_ms === "number") {
      const wait = span.attributes.queue_wait_ms;
      queueIntervals.push({ start: startMs - wait, end: startMs });
    }
  }

  const wallClockDurationMs =
    minGlobalStart !== Infinity && maxGlobalEnd !== -Infinity
      ? Math.max(0, maxGlobalEnd - minGlobalStart)
      : 0;

  const activeExecutionDurationMs = sumConsolidatedDuration(executionIntervals);
  const queueWaitDurationMs = sumConsolidatedDuration(queueIntervals);
  const approvalWaitDurationMs = sumConsolidatedDuration(approvalIntervals);
  const retryDelayDurationMs = sumConsolidatedDuration(retryIntervals);

  return {
    wallClockDurationMs,
    activeExecutionDurationMs,
    queueWaitDurationMs,
    approvalWaitDurationMs,
    retryDelayDurationMs,
    intervalsCount:
      executionIntervals.length +
      queueIntervals.length +
      approvalIntervals.length +
      retryIntervals.length,
  };
}
