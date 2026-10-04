"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { TraceSummary } from "@/lib/observability/types";
import {
  Activity,
  Layers,
  Clock,
  Zap,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Filter,
} from "lucide-react";

export default function ObservabilityDashboardPage() {
  const { workspace } = useAuth();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [componentFilter, setComponentFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    if (!workspace?.id) return;
    setIsLoading(true);
    try {
      let url = `/api/observability/traces?workspaceId=${workspace.id}&limit=50`;
      if (statusFilter !== "all") url += `&status=${statusFilter}`;
      if (componentFilter !== "all") url += `&component=${componentFilter}`;

      const [tracesRes, statsRes] = await Promise.all([
        fetch(url),
        fetch(`/api/observability/stats?workspaceId=${workspace.id}`),
      ]);

      if (tracesRes.ok) {
        const json = await tracesRes.json();
        setTraces(json.traces || []);
      }
      if (statsRes.ok) {
        const json = await statsRes.json();
        setStats(json);
      }
    } catch {
      // Manejo silencioso de fallo
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [workspace?.id, statusFilter, componentFilter]);

  return (
    <DashboardShell
      title="Observabilidad y Trazabilidad Operacional"
      subtitle="Telemetría de ejecución, métricas de latencia no-lineal y linaje completo de trazas"
    >
      <ControlPlaneNav />
      <div className="space-y-6">
        {/* Banner Superior & Controles */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-texter-surface to-texter-surface-elevated border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white tracking-tight">
                NEXTEХ Telemetry v4.8
              </span>
              <Badge variant="cyan" size="sm">
                Internal Trace Engine
              </Badge>
              <Badge variant="success" size="sm" dot>
                Multi-Tenant RLS
              </Badge>
            </div>
            <p className="text-xs text-texter-text-muted flex items-center gap-2 flex-wrap">
              <span>Desglose analítico de tiempos: Wall-Clock, Cómputo Activo, Espera en Cola y HITL</span>
              <span className="text-texter-border">•</span>
              <span className="text-emerald-400 flex items-center gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                Sanitización Activa (Capa 1 y 2)
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              leftIcon={<RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />}
              onClick={loadData}
              disabled={isLoading}
            >
              Actualizar
            </Button>
          </div>
        </div>

        {/* KPI Cards de Resumen */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card variant="elevated" padding="md" className="space-y-2 border-texter-border/80">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Trazas Analizadas</span>
              <Activity className="w-4 h-4 text-texter-cyan" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">
              {stats?.totalUniqueTraces || traces.length}
            </div>
            <p className="text-[11px] text-texter-text-dim font-mono">
              Total spans registrados: {stats?.totalSpans || 0}
            </p>
          </Card>

          <Card variant="elevated" padding="md" className="space-y-2 border-texter-border/80">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Tasa de Éxito</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">
              {stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "100%"}
            </div>
            <p className="text-[11px] text-texter-text-dim font-mono">
              Fallos registrados: {stats?.failedCount || 0}
            </p>
          </Card>

          <Card variant="elevated" padding="md" className="space-y-2 border-texter-border/80">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Latencia Promedio</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">
              {stats?.avgDurationMs || 0} ms
            </div>
            <p className="text-[11px] text-texter-text-dim font-mono">
              Excluye pausas humanas HITL
            </p>
          </Card>

          <Card variant="elevated" padding="md" className="space-y-2 border-texter-border/80">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Tokens de IA Consumidos</span>
              <Cpu className="w-4 h-4 text-texter-indigo" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">
              {((stats?.totalTokens || 0) / 1000).toFixed(1)}k
            </div>
            <p className="text-[11px] text-texter-text-dim font-mono">
              In: {((stats?.totalTokensInput || 0) / 1000).toFixed(1)}k • Out: {((stats?.totalTokensOutput || 0) / 1000).toFixed(1)}k
            </p>
          </Card>
        </div>

        {/* Filtros de Lista */}
        <div className="flex items-center justify-between gap-4 flex-wrap border-b border-texter-border/50 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-texter-text-muted flex items-center gap-1 font-mono">
              <Filter className="w-3.5 h-3.5" /> Estado:
            </span>
            {[
              { id: "all", label: "Todas" },
              { id: "completed", label: "Completadas" },
              { id: "failed", label: "Con Errores" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  statusFilter === f.id
                    ? "bg-texter-indigo text-white shadow-sm"
                    : "bg-texter-surface-subtle text-texter-text-muted hover:text-white border border-texter-border"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-mono text-texter-text-dim">
            Mostrando {traces.length} traza(s)
          </span>
        </div>

        {/* Tabla de Trazas */}
        {traces.length === 0 ? (
          <Card variant="elevated" padding="lg" className="text-center py-12">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
            <p className="text-sm font-semibold text-white">No hay trazas registradas</p>
            <p className="text-xs text-texter-text-muted mt-1">
              Las ejecuciones de Webhooks, Jobs y Agentes aparecerán automáticamente en esta vista.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {traces.map((trace) => {
              const isFailed = trace.status === "failed";
              const timing = trace.timing;

              return (
                <Card
                  key={trace.traceId}
                  variant="elevated"
                  padding="md"
                  className="border-texter-border/80 hover:border-texter-indigo/40 transition-all space-y-3"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white font-mono">
                          {trace.traceId}
                        </span>
                        <Badge
                          variant={isFailed ? "error" : "success"}
                          size="sm"
                          dot
                        >
                          {trace.status.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-texter-text-dim font-mono">
                          {trace.spansCount} span(s)
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-texter-text-muted font-mono">
                        <span>Inicio: {new Date(trace.startedAt).toLocaleTimeString()}</span>
                        <span>•</span>
                        <span>Componentes:</span>
                        {trace.components.map((c) => (
                          <span
                            key={c}
                            className="px-1.5 py-0.5 rounded bg-texter-surface-subtle border border-texter-border text-[11px] text-texter-cyan"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Desglose de Latencia No-Lineal (Corrección 3) */}
                    <div className="flex items-center gap-4 text-xs font-mono bg-texter-surface-subtle p-2.5 rounded-xl border border-texter-border/50">
                      <div>
                        <span className="text-texter-text-dim block text-[10px]">Wall-Clock</span>
                        <span className="text-white font-semibold">
                          {timing.wallClockDurationMs} ms
                        </span>
                      </div>
                      <div className="border-l border-texter-border pl-3">
                        <span className="text-texter-text-dim block text-[10px]">Cómputo Activo</span>
                        <span className="text-emerald-400 font-semibold">
                          {timing.activeExecutionDurationMs} ms
                        </span>
                      </div>
                      {timing.queueWaitDurationMs > 0 && (
                        <div className="border-l border-texter-border pl-3">
                          <span className="text-texter-text-dim block text-[10px]">Espera Cola</span>
                          <span className="text-amber-400 font-semibold">
                            {timing.queueWaitDurationMs} ms
                          </span>
                        </div>
                      )}
                      {timing.approvalWaitDurationMs > 0 && (
                        <div className="border-l border-texter-border pl-3">
                          <span className="text-texter-text-dim block text-[10px]">Espera HITL</span>
                          <span className="text-cyan-400 font-semibold">
                            {timing.approvalWaitDurationMs} ms
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end">
                      <Link href={`/observability/traces/${trace.traceId}?workspaceId=${workspace?.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                        >
                          Ver Detalle
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
