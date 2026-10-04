"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import { ConfirmationModal } from "@/components/control-plane/ConfirmationModal";
import {
  Cpu,
  RefreshCw,
  AlertTriangle,
  Play,
  RotateCcw,
  StopCircle,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface JobItem {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  priority: string;
  automation_id: string | null;
  automations?: { id: string; name: string };
  runsCount: number;
  lastRun: any;
  created_at: string;
}

export default function JobsControlPage() {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    jobId: string;
    jobName: string;
    action: "cancel" | "retry" | "recover";
    title: string;
    description: string;
    impact: string;
  }>({
    isOpen: false,
    jobId: "",
    jobName: "",
    action: "cancel",
    title: "",
    description: "",
    impact: "",
  });

  const [isExecutingAction, setIsExecutingAction] = useState(false);

  const fetchJobs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      let url = "/api/control-plane/jobs";
      if (statusFilter) url += `?status=${statusFilter}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar jobs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [statusFilter]);

  const openActionModal = (job: JobItem, action: "cancel" | "retry" | "recover") => {
    let title = "";
    let description = "";
    let impact = "";

    if (action === "cancel") {
      title = "Cancelar Runs del Job";
      description = `Solicitará la cancelación durable de todos los runs en curso y encolados para el job '${job.name}'.`;
      impact = "Transición de runs no terminales a cancellation_requested y cancelled.";
    } else if (action === "retry") {
      title = "Reintentar Job";
      description = `Re-encolará una nueva ejecución para el job '${job.name}' con fencing token incrementado.`;
      impact = "Creación de un nuevo JobRun en estado queued.";
    } else if (action === "recover") {
      title = "Recuperar Leases del Job";
      description = `Liberará y recuperará cualquier lease estancado o vencido del job '${job.name}'.`;
      impact = "Re-encolamiento atómico e incremento de fencing token.";
    }

    setModalState({
      isOpen: true,
      jobId: job.id,
      jobName: job.name,
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

      const res = await fetch(`/api/control-plane/jobs/${modalState.jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: modalState.action }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error?.message || `Error en la acción (${res.status})`);
      }

      setModalState((prev) => ({ ...prev, isOpen: false }));
      await fetchJobs();
    } catch (err: any) {
      setError(err.message || "Error al ejecutar la acción");
    } finally {
      setIsExecutingAction(false);
    }
  };

  return (
    <DashboardShell
      title="Jobs del Control Plane"
      subtitle="Supervisión de definiciones de jobs, prioridad, concurrencia y acciones de cancelación y reintento"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-texter-indigo" />
            <h2 className="text-white font-semibold text-lg">Catálogo de Jobs</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-texter-text-muted">
              {jobs.length} registros
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
                <option value="active" className="bg-texter-surface text-emerald-400">active</option>
                <option value="paused" className="bg-texter-surface text-amber-400">paused</option>
                <option value="archived" className="bg-texter-surface text-gray-400">archived</option>
              </select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={fetchJobs}
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
                  <th className="py-3 px-4 font-semibold">JOB</th>
                  <th className="py-3 px-4 font-semibold">AUTOMATION</th>
                  <th className="py-3 px-4 font-semibold">ESTADO</th>
                  <th className="py-3 px-4 font-semibold">PRIORIDAD</th>
                  <th className="py-3 px-4 font-semibold">TOTAL RUNS</th>
                  <th className="py-3 px-4 font-semibold">ÚLTIMO RUN</th>
                  <th className="py-3 px-4 font-semibold text-right">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50 text-texter-text-secondary">
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-texter-text-muted">
                      {isLoading ? "Consultando jobs..." : "No se encontraron jobs."}
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="py-3 px-4">
                        <Link
                          href={`/control-plane/jobs/${j.id}`}
                          className="font-semibold text-white hover:text-texter-cyan transition-colors"
                        >
                          {j.name}
                        </Link>
                        <div className="text-[10px] text-texter-text-muted truncate max-w-[140px]">
                          {j.id}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-texter-cyan">
                        {j.automations?.name || "Manual / Standalone"}
                      </td>
                      <td className="py-3 px-4">
                        <DecisionBadge decision={j.status} />
                      </td>
                      <td className="py-3 px-4 uppercase text-texter-indigo font-bold">
                        {j.priority || "NORMAL"}
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {j.runsCount}
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        {j.lastRun ? (
                          <div className="flex items-center gap-1.5">
                            <DecisionBadge decision={j.lastRun.status} showIcon={false} />
                            <span className="text-texter-text-muted">
                              {new Date(j.lastRun.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-texter-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openActionModal(j, "cancel")}
                            className="text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 h-auto"
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openActionModal(j, "retry")}
                            className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 px-2 py-1 h-auto"
                          >
                            Retry
                          </Button>
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
        resourceType="job"
        resourceId={modalState.jobName}
        workspaceId="Workspace Activo"
        impact={modalState.impact}
        actionLabel="Confirmar Operación"
        isLoading={isExecutingAction}
        variant={modalState.action === "cancel" ? "danger" : "warning"}
      />
    </DashboardShell>
  );
}
