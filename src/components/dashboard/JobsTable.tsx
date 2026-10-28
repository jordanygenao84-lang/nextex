"use client";

import React, { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Eye, Terminal } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";

type RunRow = {
  id: string;
  job_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  agent_id: string;
  total_tokens: number;
  durationMs: number | null;
  error_code: string | null;
  error_message: string | null;
  input: string | null;
  output: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  jobs?: { id: string; name: string } | null;
};

const RUNNING = ["running", "claimed", "waiting_approval"];
const FAILED = ["failed", "timeout", "dead_letter"];

function groupOf(status: string): "completed" | "running" | "failed" | "queued" | "cancelled" | "other" {
  if (status === "completed") return "completed";
  if (RUNNING.includes(status)) return "running";
  if (FAILED.includes(status)) return "failed";
  if (status === "queued") return "queued";
  if (status === "cancelled") return "cancelled";
  return "other";
}

// Etiquetas idénticas a /jobs: el mismo run debe llamarse igual en todas
// las páginas (antes el dashboard decía "Error" donde /jobs decía
// "Fallido"/"Descartado" y Control Plane mostraba el código en inglés).
function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="success" size="sm" dot>
          Completado
        </Badge>
      );
    case "running":
      return (
        <Badge variant="cyan" size="sm" dot>
          En ejecución
        </Badge>
      );
    case "claimed":
      return (
        <Badge variant="cyan" size="sm" dot>
          Reclamado
        </Badge>
      );
    case "waiting_approval":
      return (
        <Badge variant="warning" size="sm" dot>
          Esperando aprobación
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="warning" size="sm" dot>
          En cola
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="danger" size="sm" dot>
          Fallido
        </Badge>
      );
    case "timeout":
      return (
        <Badge variant="danger" size="sm" dot>
          Timeout
        </Badge>
      );
    case "dead_letter":
      return (
        <Badge variant="danger" size="sm" dot>
          Descartado
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="default" size="sm" dot>
          Cancelado
        </Badge>
      );
    default:
      return (
        <Badge variant="default" size="sm" dot>
          {status}
        </Badge>
      );
  }
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortId(id: string): string {
  return id ? id.slice(0, 8) : "—";
}

export const JobsTable: React.FC = () => {
  const [filter, setFilter] = useState("all");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Datos reales desde /api/control-plane/runs (antes era MOCK_JOBS fijo y
  // el botón de detalles no tenía acción). Una sola carga al montar: el
  // cargador no depende de ningún estado que él mismo recree.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-plane/runs?limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setRuns(Array.isArray(d?.runs) ? d.runs : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = [
    { id: "all", label: "Todos los Trabajos", count: runs.length },
    {
      id: "completed",
      label: "Completados",
      count: runs.filter((j) => groupOf(j.status) === "completed").length,
    },
    {
      id: "running",
      label: "En Ejecución",
      count: runs.filter((j) => groupOf(j.status) === "running").length,
    },
    {
      id: "failed",
      label: "Fallidos (incl. Descartados)",
      count: runs.filter((j) => groupOf(j.status) === "failed").length,
    },
    {
      id: "queued",
      label: "En cola",
      count: runs.filter((j) => groupOf(j.status) === "queued").length,
    },
    {
      id: "cancelled",
      label: "Cancelados",
      count: runs.filter((j) => groupOf(j.status) === "cancelled").length,
    },
  ];

  const filteredJobs = runs.filter((job) => {
    if (filter === "all") return true;
    return groupOf(job.status) === filter;
  });

  return (
    <Card variant="elevated" padding="none">
      {/* Header and Tabs */}
      <div className="p-4 sm:p-5 border-b border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-texter-indigo" />
            Registro de Trabajos Autónomos
          </h2>
          <p className="text-xs text-texter-text-muted mt-0.5">
            Ejecuciones reales de job_runs, las 50 más recientes
          </p>
        </div>
        <Tabs tabs={tabs} activeTab={filter} onChange={setFilter} />
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-texter-surface-subtle/80 text-[11px] uppercase font-mono tracking-wider text-texter-text-muted border-b border-texter-border">
            <tr>
              <th className="py-3 px-4 sm:px-5">ID & Tarea</th>
              <th className="py-3 px-4">Agente</th>
              <th className="py-3 px-4">Intento</th>
              <th className="py-3 px-4">Estado</th>
              <th className="py-3 px-4 text-right">Tokens</th>
              <th className="py-3 px-4 text-right">Latencia</th>
              <th className="py-3 px-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-texter-border/50 text-xs">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 px-5 text-center text-texter-text-muted">
                  Cargando ejecuciones…
                </td>
              </tr>
            ) : filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 px-5 text-center text-texter-text-muted">
                  Sin ejecuciones todavía.
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => (
                <React.Fragment key={job.id}>
                  <tr className="hover:bg-texter-surface-hover/50 transition-colors group">
                    <td className="py-3.5 px-4 sm:px-5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-white group-hover:text-texter-indigo transition-colors truncate max-w-xs sm:max-w-md">
                          {job.jobs?.name || "Trabajo sin nombre"}
                        </span>
                        <span className="text-[10px] text-texter-text-dim font-mono">
                          {shortId(job.id)} • {fmtDate(job.created_at)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-texter-text-secondary font-medium font-mono">
                      {shortId(job.agent_id)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-texter-text-muted">
                      {job.attempt}/{job.max_attempts}
                    </td>
                    <td className="py-3.5 px-4">{statusBadge(job.status)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-texter-text-secondary">
                      {job.total_tokens ?? 0}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-texter-cyan">
                      {fmtDuration(job.durationMs)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() =>
                          setExpandedId((prev) => (prev === job.id ? null : job.id))
                        }
                        className="p-1.5 rounded-lg text-texter-text-muted hover:text-white hover:bg-texter-surface border border-transparent hover:border-texter-border transition-colors"
                        title="Ver detalles del pipeline"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  {expandedId === job.id && (
                    <tr className="bg-texter-surface-subtle/40">
                      <td colSpan={7} className="py-3 px-4 sm:px-5">
                        <div className="space-y-1.5 text-[11px] font-mono text-texter-text-secondary break-all">
                          <p>
                            <span className="text-texter-text-muted">ID: </span>
                            {job.id}
                          </p>
                          <p>
                            <span className="text-texter-text-muted">Estado real: </span>
                            {job.status}
                            <span className="text-texter-text-muted"> • En cola: </span>
                            {fmtDate(job.queued_at)}
                            <span className="text-texter-text-muted"> • Inicio: </span>
                            {fmtDate(job.started_at)}
                            <span className="text-texter-text-muted"> • Fin: </span>
                            {fmtDate(job.completed_at)}
                          </p>
                          {job.error_code || job.error_message ? (
                            <p className="text-texter-rose">
                              <span className="text-texter-text-muted">Error: </span>
                              {job.error_code ? `[${job.error_code}] ` : ""}
                              {job.error_message || ""}
                            </p>
                          ) : null}
                          {job.input ? (
                            <p>
                              <span className="text-texter-text-muted">Entrada: </span>
                              {job.input.slice(0, 500)}
                              {job.input.length > 500 ? "…" : ""}
                            </p>
                          ) : null}
                          {job.output ? (
                            <p>
                              <span className="text-texter-text-muted">Salida: </span>
                              {job.output.slice(0, 500)}
                              {job.output.length > 500 ? "…" : ""}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="p-3 bg-texter-surface-subtle/50 border-t border-texter-border flex items-center justify-between text-xs text-texter-text-dim px-5">
        <span>
          Mostrando {filteredJobs.length} de {runs.length} ejecuciones
        </span>
        <span className="font-mono">Datos reales • job_runs</span>
      </div>
    </Card>
  );
};
