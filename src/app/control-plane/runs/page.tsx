"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import { ConfirmationModal } from "@/components/control-plane/ConfirmationModal";
import {
  PlayCircle,
  RefreshCw,
  AlertTriangle,
  StopCircle,
  RotateCcw,
  Clock,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface RunItem {
  id: string;
  job_id: string;
  workspace_id: string;
  worker_id: string | null;
  status: string;
  fencing_token: number;
  attempt: number;
  durationMs: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  jobs?: { id: string; name: string };
  workers?: { id: string; worker_identity: string };
}

export default function RunsControlPage() {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    runId: string;
    action: "cancel" | "retry";
    title: string;
    description: string;
    impact: string;
  }>({
    isOpen: false,
    runId: "",
    action: "cancel",
    title: "",
    description: "",
    impact: "",
  });

  const [isExecutingAction, setIsExecutingAction] = useState(false);

  const fetchRuns = async () => {
    try {
      setIsLoading(true);
      setError(null);
      let url = "/api/control-plane/runs";
      if (statusFilter) url += `?status=${statusFilter}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar runs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [statusFilter]);

  const openActionModal = (run: RunItem, action: "cancel" | "retry") => {
    let title = "";
    let description = "";
    let impact = "";

    if (action === "cancel") {
      title = "Cancelar Ejecución (Job Run)";
      description = `Solicitará la cancelación durable del JobRun '${run.id}'. Si está en ejecución, se emitirá una señal de aborto al worker.`;
      impact = "Transición a cancellation_requested y revocación de lease.";
    } else if (action === "retry") {
      title = "Reintentar Job Run";
      description = `Re-encolará el JobRun '${run.id}' incrementando el fencing token para ejecución segura.`;
      impact = "Transición a queued, incremento de fencing token y liberación de worker previo.";
    }

    setModalState({
      isOpen: true,
      runId: run.id,
      action,
      title,
      description,
      impact,
    });
  };

  const handleConfirmAction = async () => {
    try {
      setIsExecutingAction(true);
      setError(null);

      const res = await fetch("/api/control-plane/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: modalState.runId,
          action: modalState.action,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error?.message || `Error en la acción (${res.status})`);
      }

      setModalState((prev) => ({ ...prev, isOpen: false }));
      await fetchRuns();
    } catch (err: any) {
      setError(err.message || "Error al ejecutar la acción");
    } finally {
      setIsExecutingAction(false);
    }
  };

  return (
    <DashboardShell
      title="Ejecuciones (Job Runs)"
      subtitle="Supervisión en tiempo real de ejecuciones durables, fencing tokens, duración y control de cancelaciones"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-texter-cyan" />
            <h2 className="text-white font-semibold text-lg">Ejecuciones Registradas</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-texter-text-muted">
              {runs.length} runs
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-texter-surface border border-texter-border rounded-xl px-3 py-1.5 text-xs font-mono">
              <Filter className="w-3.5 h-3.5 text-texter-text-muted" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-white focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-texter-surface text-white">Todos los Estados</option>
                <option value="queued" className="bg-texter-surface text-cyan-400">queued</option>
                <option value="claimed" className="bg-texter-surface text-amber-400">claimed</option>
                <option value="running" className="bg-texter-surface text-indigo-400">running</option>
                <option value="waiting_approval" className="bg-texter-surface text-amber-400">waiting_approval</option>
                <option value="completed" className="bg-texter-surface text-emerald-400">completed</option>
                <option value="failed" className="bg-texter-surface text-rose-400">failed</option>
                <option value="cancelled" className="bg-texter-surface text-gray-400">cancelled</option>
              </select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={fetchRuns}
              disabled={isLoading}
              className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refrescar
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-texter-surface border border-texter-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-texter-border bg-texter-surface-subtle/40 text-texter-text-muted">
                  <th className="py-3 px-4 font-semibold">RUN ID</th>
                  <th className="py-3 px-4 font-semibold">JOB ASOCIADO</th>
                  <th className="py-3 px-4 font-semibold">ESTADO</th>
                  <th className="py-3 px-4 font-semibold">WORKER</th>
                  <th className="py-3 px-4 font-semibold">FENCING TOKEN</th>
                  <th className="py-3 px-4 font-semibold">DURACIÓN</th>
                  <th className="py-3 px-4 font-semibold">CREADO</th>
                  <th className="py-3 px-4 font-semibold text-right">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50 text-texter-text-secondary">
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-texter-text-muted">
                      {isLoading ? "Consultando ejecuciones..." : "No se encontraron ejecuciones."}
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="py-3 px-4">
                        <Link
                          href={`/control-plane/runs/${r.id}`}
                          className="font-semibold text-white hover:text-texter-cyan transition-colors"
                        >
                          #{r.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-white">
                        {r.jobs?.name || r.job_id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <DecisionBadge decision={r.status} />
                      </td>
                      <td className="py-3 px-4 text-texter-text-muted">
                        {r.worker_id || "—"}
                      </td>
                      <td className="py-3 px-4 text-texter-cyan font-bold">
                        {r.fencing_token ?? 1}
                      </td>
                      <td className="py-3 px-4 text-texter-text-muted">
                        {r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "En curso"}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-texter-text-muted">
                        {new Date(r.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {["queued", "claimed", "running", "waiting_approval"].includes(r.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openActionModal(r, "cancel")}
                              className="text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 h-auto"
                            >
                              Cancel
                            </Button>
                          )}
                          {["failed", "cancelled", "dead_letter"].includes(r.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openActionModal(r, "retry")}
                              className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 px-2 py-1 h-auto"
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={modalState.title}
        description={modalState.description}
        resourceType="job_run"
        resourceId={modalState.runId}
        workspaceId="Workspace Activo"
        impact={modalState.impact}
        actionLabel="Confirmar Operación"
        isLoading={isExecutingAction}
        variant={modalState.action === "cancel" ? "danger" : "warning"}
      />
    </DashboardShell>
  );
}
