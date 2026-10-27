"use client";

import React, { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Activity, AlertTriangle, CheckCircle, Clock } from "lucide-react";

interface RunItem {
  id: string;
  status: string;
  created_at: string;
  jobs?: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  completed: "Completado",
  failed: "Fallido",
  timeout: "Timeout",
  dead_letter: "Descartado",
  cancelled: "Cancelado",
  queued: "En cola",
  running: "En ejecución",
  claimed: "Reclamado",
  waiting_approval: "Esperando aprobación",
};

// Actividad real: las ejecuciones más recientes del workspace (antes era
// una lista fija de eventos de muestra con la etiqueta "En vivo").
export const ActivityFeed: React.FC = () => {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-plane/runs?limit=10")
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

  const getIcon = (status: string) => {
    if (status === "failed" || status === "timeout" || status === "dead_letter") {
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    }
    if (status === "completed") {
      return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    }
    return <Clock className="w-4 h-4 text-cyan-400" />;
  };

  return (
    <Card variant="elevated" padding="none">
      <div className="p-4 border-b border-texter-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-texter-cyan" />
          Actividad del Sistema & Eventos
        </h3>
        <span className="text-[11px] font-mono text-texter-text-muted">
          Últimas ejecuciones
        </span>
      </div>

      <div className="p-4 divide-y divide-texter-border/40 space-y-3">
        {loading ? (
          <p className="text-xs text-texter-text-muted text-center py-4">
            Cargando actividad…
          </p>
        ) : runs.length === 0 ? (
          <p className="text-xs text-texter-text-muted text-center py-4">
            Sin actividad reciente.
          </p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="pt-3 first:pt-0 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-texter-surface-subtle border border-texter-border shrink-0 mt-0.5">
                {getIcon(run.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white truncate">
                    {run.jobs?.name || "Ejecución"}
                  </p>
                  <span className="text-[10px] font-mono text-texter-text-dim shrink-0">
                    {run.created_at
                      ? new Date(run.created_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
                <p className="text-[11px] text-texter-text-muted mt-0.5 leading-relaxed">
                  Estado: {STATUS_LABEL[run.status] ?? run.status}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
