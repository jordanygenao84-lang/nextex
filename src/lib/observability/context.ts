/**
 * NEXTEХ Observability — Contexto Asíncrono Aislado y Generador de IDs Internos
 * Fase 4.8: Concurrencia segura mediante AsyncLocalStorage.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { TraceContext } from "./types";

const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generador de IDs Canónicos Internos de NEXTEХ
 * (Nota: No son W3C directos; para exportación externa a OTel se usará un adaptador futuro).
 */
export function generateTraceId(): string {
  return `trc_${randomUUID().replace(/-/g, "")}`;
}

export function generateSpanId(): string {
  return `spn_${randomUUID().replace(/-/g, "")}`;
}

export class ObservabilityContext {
  /**
   * Ejecuta una función dentro de un contexto de traza inmutable.
   */
  public static run<T>(
    context: TraceContext,
    fn: () => Promise<T> | T
  ): Promise<T> | T {
    const frozenContext: TraceContext = Object.freeze({
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    });
    return asyncLocalStorage.run(frozenContext, fn);
  }

  /**
   * Obtiene el contexto de traza activo en la rama asíncrona actual.
   */
  public static current(): TraceContext | undefined {
    return asyncLocalStorage.getStore();
  }

  /**
   * Ejecuta una función hija heredando traceId y workspaceId pero con nuevo spanId y parentSpanId.
   */
  public static withChild<T>(
    newSpanId: string,
    fn: (childContext: TraceContext) => Promise<T> | T
  ): Promise<T> | T {
    const current = ObservabilityContext.current();
    if (!current) {
      throw new Error("No hay contexto de observabilidad activo para derivar un span hijo");
    }

    const childContext: TraceContext = Object.freeze({
      traceId: current.traceId,
      spanId: newSpanId,
      parentSpanId: current.spanId,
      workspaceId: current.workspaceId,
      userId: current.userId,
    });

    return asyncLocalStorage.run(childContext, () => fn(childContext));
  }
}
