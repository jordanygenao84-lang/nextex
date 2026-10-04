"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import { ConfirmationModal } from "@/components/control-plane/ConfirmationModal";
import {
  Cpu,
  ArrowLeft,
  PlayCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params?.id as string;

  const [job, setJob] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobDetail = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/control-plane/jobs/${jobId}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setJob(data.job);
      setRuns(data.runs || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar detalle del job");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (jobId) fetchJobDetail();
  }, [jobId]);

  return (
    <DashboardShell
      title={`Job: ${job?.name || "Cargando..."}`}
      subtitle="Inspección granular de ejecuciones, linaje de agente y pasos de herramientas"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/control-plane/jobs"
            className="inline-flex items-center gap-2 text-xs font-mono text-texter-text-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a Jobs
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchJobDetail}
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

        {/* Ficha técnica del Job */}
        {job && (
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-white font-bold text-lg">{job.name}</h2>
                <p className="text-xs text-texter-text-muted font-mono mt-0.5">ID: {job.id}</p>
              </div>
              <div className="flex items-center gap-3">
                <DecisionBadge decision={job.status} />
                <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-texter-surface-subtle border border-texter-border text-texter-indigo font-bold uppercase">
                  {job.priority || "NORMAL"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono pt-3 border-t border-texter-border/50">
              <div>
                <span className="text-texter-text-muted">Automatización:</span>
                <p className="text-white font-medium">{job.automations?.name || "Directo"}</p>
              </div>
              <div>
                <span className="text-texter-text-muted">Timeout:</span>
                <p className="text-white font-medium">{job.timeout_seconds || 60}s</p>
              </div>
              <div>
                <span className="text-texter-text-muted">Max Intentos:</span>
                <p className="text-white font-medium">{job.max_attempts || 3}</p>
              </div>
              <div>
                <span className="text-texter-text-muted">Creado:</span>
                <p className="text-white font-medium">{new Date(job.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Historial de Runs y Linaje */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-texter-cyan" />
            <h3 className="text-white font-semibold text-base">Historial de Ejecuciones (Job Runs)</h3>
            <span className="text-xs font-mono text-texter-text-muted">({runs.length})</span>
          </div>

          <div className="space-y-3">
            {runs.length === 0 ? (
              <div className="bg-texter-surface border border-texter-border rounded-xl p-8 text-center text-xs font-mono text-texter-text-muted">
                {isLoading ? "Consultando ejecuciones..." : "No hay runs registrados para este job."}
              </div>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  className="bg-texter-surface border border-texter-border rounded-xl p-4 space-y-3 hover:border-texter-border/80 transition-all text-xs font-mono"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-texter-border/50 pb-2.5">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/control-plane/runs/${r.id}`}
                        className="text-white font-bold hover:text-texter-cyan flex items-center gap-1.5"
                      >
                        Run #{r.id.slice(0, 8)}
                        <ChevronRight className="w-3.5 h-3.5 text-texter-text-muted" />
                      </Link>
                      <DecisionBadge decision={r.status} />
                    </div>
                    <div className="flex items-center gap-4 text-texter-text-muted text-[11px]">
                      <span>Fencing Token: <strong className="text-texter-cyan">{r.fencing_token ?? 1}</strong></span>
                      <span>Intento: <strong>{r.attempt ?? 1}</strong></span>
                      <span>Worker: <strong>{r.worker_id || "N/A"}</strong></span>
                    </div>
                  </div>

                  {/* Detalle de Agent Run y Pasos si existen */}
                  {r.agent_runs && r.agent_runs.length > 0 && (
                    <div className="bg-texter-surface-subtle border border-texter-border/40 rounded-lg p-3 space-y-2">
                      <div className="text-[11px] text-texter-text-muted font-semibold flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-texter-indigo" />
                        Linaje de Agente: {r.agent_runs[0].agent_id || "N/A"} (Run ID: {r.agent_runs[0].id.slice(0, 8)})
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(r.agent_runs[0].agent_steps || []).map((step: any) => (
                          <div
                            key={step.id}
                            className="px-2.5 py-1 rounded bg-texter-surface border border-texter-border flex items-center gap-2 text-[10px]"
                          >
                            <span className="text-texter-text-muted">Paso {step.step_number}:</span>
                            <span className="text-white font-bold">{step.step_type}</span>
                            <DecisionBadge decision={step.status} showIcon={false} className="text-[9px] px-1.5 py-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
