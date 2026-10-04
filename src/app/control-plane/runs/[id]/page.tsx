"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import {
  PlayCircle,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Clock,
  Layers,
  Server,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function RunDetailPage() {
  const params = useParams();
  const runId = params?.id as string;

  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRunDetail = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/control-plane/runs/${runId}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Error al cargar detalle de ejecución");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (runId) fetchRunDetail();
  }, [runId]);

  const run = data?.run;
  const timeline = data?.timeline || [];
  const leases = data?.leases || [];
  const auditEvents = data?.auditEvents || [];

  return (
    <DashboardShell
      title={`Ejecución #${runId?.slice(0, 8) || "..."}`}
      subtitle="Timeline determinista de eventos, transiciones de estado, leases y correlación de fencing"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/control-plane/runs"
            className="inline-flex items-center gap-2 text-xs font-mono text-texter-text-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a Runs
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchRunDetail}
            disabled={isLoading}
            className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Ficha técnica del Run */}
        {run && (
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-white font-bold text-base">Job: {run.jobs?.name || run.job_id}</h2>
                  <DecisionBadge decision={run.status} />
                </div>
                <p className="text-[11px] text-texter-text-muted mt-1">ID: {run.id}</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-right">
                  <span className="text-[10px] text-texter-text-muted block">FENCING TOKEN</span>
                  <span className="text-texter-cyan font-bold text-sm">{run.fencing_token ?? 1}</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-right">
                  <span className="text-[10px] text-texter-text-muted block">INTENTO</span>
                  <span className="text-white font-bold text-sm">{run.attempt ?? 1}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-texter-border/50 text-[11px]">
              <div>
                <span className="text-texter-text-muted block">Worker Actual:</span>
                <span className="text-white font-medium">{run.worker_id || "Sin asignar"}</span>
              </div>
              <div>
                <span className="text-texter-text-muted block">Lease Expira:</span>
                <span className="text-texter-cyan font-medium">
                  {run.lease_expires_at ? new Date(run.lease_expires_at).toLocaleTimeString() : "—"}
                </span>
              </div>
              <div>
                <span className="text-texter-text-muted block">Inicio:</span>
                <span className="text-white font-medium">
                  {run.started_at ? new Date(run.started_at).toLocaleTimeString() : "—"}
                </span>
              </div>
              <div>
                <span className="text-texter-text-muted block">Fin:</span>
                <span className="text-white font-medium">
                  {run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : "En progreso"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Timeline de Ejecución Canónico */}
        <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-texter-cyan" />
            <h3 className="text-white font-semibold text-sm">Timeline Canónico de Ejecución</h3>
          </div>

          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-texter-border">
            {timeline.length === 0 ? (
              <p className="text-xs font-mono text-texter-text-muted">No hay eventos en el timeline.</p>
            ) : (
              timeline.map((item: any, idx: number) => (
                <div key={idx} className="relative flex items-start gap-3 text-xs font-mono">
                  <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-texter-indigo border-2 border-texter-bg shrink-0" />
                  <div className="flex-1 bg-texter-surface-subtle border border-texter-border rounded-xl p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white uppercase text-[11px]">{item.stage}</span>
                      <span className="text-[10px] text-texter-text-muted">
                        {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : ""}
                      </span>
                    </div>
                    <p className="text-texter-text-secondary text-[11px]">{item.description}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Leases y Auditoría Inmutable */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <h4 className="font-semibold text-white">Leases del Worker ({leases.length})</h4>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {leases.length === 0 ? (
                <p className="text-texter-text-muted text-[11px]">No hay leases registrados.</p>
              ) : (
                leases.map((l: any) => (
                  <div
                    key={l.id}
                    className="p-2.5 rounded-lg bg-texter-surface-subtle border border-texter-border flex items-center justify-between text-[11px]"
                  >
                    <div>
                      <span className="text-white block font-medium">Worker: {l.worker_id.slice(0, 8)}</span>
                      <span className="text-[10px] text-texter-text-muted">
                        Fencing: <strong className="text-texter-cyan">{l.fencing_token}</strong>
                      </span>
                    </div>
                    <DecisionBadge decision={l.status} showIcon={false} className="text-[10px]" />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <h4 className="font-semibold text-white">Auditoría Append-Only ({auditEvents.length})</h4>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {auditEvents.length === 0 ? (
                <p className="text-texter-text-muted text-[11px]">Sin registros de auditoría.</p>
              ) : (
                auditEvents.map((a: any) => (
                  <div
                    key={a.id}
                    className="p-2.5 rounded-lg bg-texter-surface-subtle border border-texter-border space-y-1 text-[11px]"
                  >
                    <div className="flex justify-between">
                      <span className="text-texter-indigo font-bold">{a.action}</span>
                      <span className="text-[10px] text-texter-text-muted">
                        {new Date(a.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[10px] text-texter-text-muted truncate">
                      Actor: {a.actor_type} ({a.actor_id})
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
