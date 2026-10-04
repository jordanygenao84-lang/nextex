"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { ObservabilitySpan, TimingBreakdown } from "@/lib/observability/types";
import {
  ArrowLeft,
  Clock,
  Layers,
  CheckCircle2,
  AlertCircle,
  Cpu,
  ShieldCheck,
  Terminal,
  Database,
  ChevronDown,
  ChevronRight,
  Code2,
} from "lucide-react";

interface SpanTreeNode {
  span: ObservabilitySpan;
  children: SpanTreeNode[];
}

function SpanNodeView({
  node,
  depth = 0,
  onSelect,
  selectedSpanId,
}: {
  node: SpanTreeNode;
  depth?: number;
  onSelect: (span: ObservabilitySpan) => void;
  selectedSpanId?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const span = node.span;
  const isSelected = selectedSpanId === span.span_id;
  const isFailed = span.status === "failed";
  const hasChildren = node.children.length > 0;

  return (
    <div className="space-y-1">
      <div
        onClick={() => onSelect(span)}
        className={`p-3 rounded-xl border text-xs font-mono transition-all cursor-pointer flex items-center justify-between gap-3 ${
          isSelected
            ? "bg-texter-indigo/20 border-texter-indigo text-white shadow-sm"
            : "bg-texter-surface-subtle hover:bg-texter-surface border-texter-border text-texter-text-secondary"
        }`}
        style={{ marginLeft: `${depth * 20}px` }}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="text-texter-text-muted hover:text-white"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <div className="w-3.5 h-3.5" />
          )}

          <Badge
            variant={
              span.component === "ai_gateway"
                ? "cyan"
                : span.component === "worker"
                ? "default"
                : span.component === "gateway"
                ? "warning"
                : "default"
            }
            size="sm"
          >
            {span.component}
          </Badge>

          <span className="font-semibold text-white truncate">{span.operation}</span>
          <span className="text-[11px] text-texter-text-dim">({span.span_id})</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-texter-cyan">{span.duration_ms || 0} ms</span>
          <Badge variant={isFailed ? "error" : "success"} size="sm" dot>
            {span.status.toUpperCase()}
          </Badge>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <SpanNodeView
              key={child.span.span_id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedSpanId={selectedSpanId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TraceDetailPage() {
  const { workspace } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const traceId = params.traceId as string;
  const workspaceId = searchParams.get("workspaceId") || workspace?.id;

  const [traceData, setTraceData] = useState<{
    tree: SpanTreeNode[];
    spans: ObservabilitySpan[];
    timing: TimingBreakdown;
    workspaceId: string;
  } | null>(null);

  const [selectedSpan, setSelectedSpan] = useState<ObservabilitySpan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTrace() {
      if (!traceId) return;
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/observability/traces/${traceId}${workspaceId ? `?workspaceId=${workspaceId}` : ""}`
        );

        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message || "No se pudo recuperar la traza.");
        }

        const data = await res.json();
        setTraceData(data);
        if (data.spans?.length > 0) {
          setSelectedSpan(data.spans[0]);
        }
      } catch (err: any) {
        setError(err?.message || "Error inesperado al cargar la traza.");
      } finally {
        setIsLoading(false);
      }
    }

    loadTrace();
  }, [traceId, workspaceId]);

  return (
    <DashboardShell
      title={`Detalle de Traza: ${traceId}`}
      subtitle="Visualización jerárquica de árbol causal y desglose de métricas por span"
    >
      <div className="space-y-6">
        {/* Cabecera y Navegación */}
        <div className="flex items-center justify-between">
          <Link href="/observability">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
            >
              Volver al Listado
            </Button>
          </Link>

          <span className="text-xs font-mono text-texter-text-dim">
            Workspace: {traceData?.workspaceId || workspaceId}
          </span>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Desglose de Tiempos */}
        {traceData?.timing && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-texter-surface p-4 rounded-2xl border border-texter-border text-xs font-mono">
            <div>
              <span className="text-texter-text-dim block text-[10px]">Wall-Clock Global</span>
              <span className="text-white text-base font-bold">
                {traceData.timing.wallClockDurationMs} ms
              </span>
            </div>
            <div>
              <span className="text-texter-text-dim block text-[10px]">Cómputo Técnico Activo</span>
              <span className="text-emerald-400 text-base font-bold">
                {traceData.timing.activeExecutionDurationMs} ms
              </span>
            </div>
            <div>
              <span className="text-texter-text-dim block text-[10px]">Espera en Cola</span>
              <span className="text-amber-400 text-base font-bold">
                {traceData.timing.queueWaitDurationMs} ms
              </span>
            </div>
            <div>
              <span className="text-texter-text-dim block text-[10px]">Espera Humana HITL</span>
              <span className="text-cyan-400 text-base font-bold">
                {traceData.timing.approvalWaitDurationMs} ms
              </span>
            </div>
          </div>
        )}

        {/* Grid: Árbol Causal a la izquierda + Panel de Detalles a la derecha */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Árbol de Spans (7 columnas) */}
          <div className="lg:col-span-7 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <Layers className="w-4 h-4 text-texter-cyan" />
              Árbol Causal de Spans ({traceData?.spans?.length || 0})
            </h3>

            {isLoading ? (
              <Card variant="elevated" padding="md" className="text-center py-8 text-xs text-texter-text-muted font-mono">
                Cargando jerarquía de traza...
              </Card>
            ) : traceData?.tree && traceData.tree.length > 0 ? (
              <div className="space-y-1">
                {traceData.tree.map((rootNode) => (
                  <SpanNodeView
                    key={rootNode.span.span_id}
                    node={rootNode}
                    onSelect={(span) => setSelectedSpan(span)}
                    selectedSpanId={selectedSpan?.span_id}
                  />
                ))}
              </div>
            ) : (
              <Card variant="elevated" padding="md" className="text-center py-8 text-xs text-texter-text-muted">
                Sin spans para renderizar.
              </Card>
            )}
          </div>

          {/* Panel de Detalles del Span Seleccionado (5 columnas) */}
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <Terminal className="w-4 h-4 text-texter-indigo" />
              Inspector de Span
            </h3>

            {selectedSpan ? (
              <Card variant="elevated" padding="md" className="space-y-4 border-texter-border font-mono text-xs">
                <div className="space-y-1 pb-3 border-b border-texter-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{selectedSpan.operation}</span>
                    <Badge
                      variant={selectedSpan.status === "failed" ? "error" : "success"}
                      size="sm"
                    >
                      {selectedSpan.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-texter-text-dim">ID: {selectedSpan.span_id}</p>
                  {selectedSpan.parent_span_id && (
                    <p className="text-[11px] text-texter-text-dim">
                      Parent ID: {selectedSpan.parent_span_id}
                    </p>
                  )}
                </div>

                {/* Métricas clave */}
                <div className="grid grid-cols-2 gap-2 text-[11px] bg-texter-surface-subtle p-2.5 rounded-xl border border-texter-border/50">
                  <div>
                    <span className="text-texter-text-dim">Componente:</span>
                    <p className="text-white font-semibold">{selectedSpan.component}</p>
                  </div>
                  <div>
                    <span className="text-texter-text-dim">Tipo:</span>
                    <p className="text-white font-semibold">{selectedSpan.span_type}</p>
                  </div>
                  <div>
                    <span className="text-texter-text-dim">Duración:</span>
                    <p className="text-texter-cyan font-semibold">{selectedSpan.duration_ms || 0} ms</p>
                  </div>
                  <div>
                    <span className="text-texter-text-dim">Inicio:</span>
                    <p className="text-white font-semibold">
                      {new Date(selectedSpan.started_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                {/* Referencias de Negocio vinculadas */}
                <div className="space-y-1.5 pt-2 border-t border-texter-border/50 text-[11px]">
                  <span className="text-texter-text-dim block">Entidades de Negocio Correlacionadas:</span>
                  {selectedSpan.job_run_id && <p className="text-white">Job Run: {selectedSpan.job_run_id}</p>}
                  {selectedSpan.agent_run_id && <p className="text-white">Agent Run: {selectedSpan.agent_run_id}</p>}
                  {selectedSpan.agent_step_id && <p className="text-white">Step: {selectedSpan.agent_step_id}</p>}
                  {selectedSpan.integration_event_id && <p className="text-white">Event: {selectedSpan.integration_event_id}</p>}
                  {selectedSpan.tool_id && <p className="text-white">Tool: {selectedSpan.tool_id}</p>}
                  {selectedSpan.ai_request_id && <p className="text-white">AI Req: {selectedSpan.ai_request_id}</p>}
                </div>

                {/* Diagnóstico de error si existe */}
                {selectedSpan.error_code && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 space-y-1 text-rose-300">
                    <span className="font-bold text-[11px]">
                      {selectedSpan.error_category}: {selectedSpan.error_code}
                    </span>
                    <p className="text-[11px] leading-relaxed">
                      {selectedSpan.error_message_safe}
                    </p>
                  </div>
                )}

                {/* Atributos sanitizados */}
                <div className="space-y-1.5 pt-2 border-t border-texter-border/50">
                  <span className="text-texter-text-dim block">Atributos Sanitizados (Capa 1/2):</span>
                  <pre className="p-3 rounded-xl bg-black/50 border border-texter-border/50 text-[11px] text-texter-cyan overflow-x-auto max-h-60">
                    {JSON.stringify(selectedSpan.attributes, null, 2)}
                  </pre>
                </div>
              </Card>
            ) : (
              <Card variant="elevated" padding="md" className="text-center py-8 text-xs text-texter-text-muted font-mono">
                Selecciona un span en el árbol para inspeccionar sus atributos y telemetría.
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
