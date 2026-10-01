"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { Job, JobRun } from "@/lib/jobs/types";
import {
  Briefcase,
  Plus,
  Play,
  Pause,
  Archive,
  RefreshCw,
  Clock,
  Terminal,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
} from "lucide-react";

export default function JobsPage() {
  const { workspace } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  // Crear Job Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [input, setInput] = useState("");
  const [agentId, setAgentId] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (workspace?.id) {
      loadJobs();
    }
  }, [workspace?.id]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/jobs?workspaceId=${workspace?.id}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const loadJobRuns = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/runs`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch {
      // Fallback
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !input || !agentId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          agentId,
          name,
          description,
          input,
          timeoutSeconds,
          maxConcurrentRuns,
        }),
      });

      if (res.ok) {
        setIsCreateOpen(false);
        setName("");
        setDescription("");
        setInput("");
        loadJobs();
      }
    } catch {
      // Error
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTriggerRun = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/run`, { method: "POST" });
      if (res.ok) {
        loadJobRuns(jobId);
      }
    } catch {
      // Error
    }
  };

  const handleStatusChange = async (jobId: string, action: "activate" | "pause" | "archive") => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/${action}`, { method: "POST" });
      if (res.ok) {
        loadJobs();
      }
    } catch {
      // Error
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success" size="sm" dot>Activo</Badge>;
      case "paused":
        return <Badge variant="warning" size="sm" dot>Pausado</Badge>;
      case "archived":
        return <Badge variant="default" size="sm" dot>Archivado</Badge>;
      default:
        return <Badge variant="cyan" size="sm" dot>Borrador</Badge>;
    }
  };

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Cabecera */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-texter-border pb-5">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-texter-indigo" />
              Trabajos Autónomos Durables (Durable Jobs)
            </h1>
            <p className="text-xs text-texter-text-muted mt-1">
              Ejecuciones asíncronas persistentes, cola transaccional y orquestación con leases temporales.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nuevo Job
          </Button>
        </div>

        {/* Lista de Jobs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <Card key={job.id} variant="elevated" className="space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-white text-base">{job.name}</h3>
                  <p className="text-xs text-texter-text-muted line-clamp-1">{job.description || "Sin descripción"}</p>
                </div>
                {getStatusBadge(job.status)}
              </div>

              <div className="text-xs font-mono bg-texter-surface-subtle p-2 rounded border border-texter-border space-y-1">
                <div className="flex justify-between text-texter-text-dim">
                  <span>Trigger:</span>
                  <span className="text-white capitalize">{job.trigger_type}</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Timeout:</span>
                  <span className="text-white">{job.timeout_seconds}s</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Concurrencia:</span>
                  <span className="text-white">{job.max_concurrent_runs} máx</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Versión Config:</span>
                  <span className="text-texter-cyan">v{job.configuration_version}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-texter-border">
                <div className="flex items-center gap-1">
                  {job.status === "active" ? (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(job.id, "pause")} title="Pausar Job">
                      <Pause className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(job.id, "activate")} title="Activar Job">
                      <Play className="w-3.5 h-3.5 text-texter-success" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleStatusChange(job.id, "archive")} title="Archivar Job">
                    <Archive className="w-3.5 h-3.5 text-texter-text-dim" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedJob(job);
                      loadJobRuns(job.id);
                    }}
                  >
                    Ver Runs
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={job.status !== "active"}
                    onClick={() => handleTriggerRun(job.id)}
                    className="flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    Ejecutar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Modal / Panel de Runs */}
        {selectedJob && (
          <Card variant="elevated" className="mt-8 space-y-4">
            <div className="flex justify-between items-center border-b border-texter-border pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-texter-indigo" />
                Historial de Ejecuciones — {selectedJob.name}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}>
                Cerrar
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                  <tr>
                    <th className="p-3">Run ID</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Prioridad</th>
                    <th className="p-3">Intento</th>
                    <th className="p-3">Worker / Fencing</th>
                    <th className="p-3">Tokens</th>
                    <th className="p-3">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-texter-border/50">
                  {runs.map((r) => (
                    <tr key={r.id} className="hover:bg-texter-surface-hover/50">
                      <td className="p-3 font-mono text-white">{r.id.substring(0, 8)}...</td>
                      <td className="p-3">{getStatusBadge(r.status)}</td>
                      <td className="p-3 capitalize">{r.priority}</td>
                      <td className="p-3">{r.attempt} / {r.max_attempts}</td>
                      <td className="p-3 font-mono text-texter-text-dim">
                        {r.worker_id ? `${r.worker_id.substring(0, 10)}... (T:${r.fencing_token})` : "—"}
                      </td>
                      <td className="p-3 font-mono">{r.total_tokens}</td>
                      <td className="p-3 text-texter-text-muted">{new Date(r.created_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-texter-text-dim">
                        No hay ejecuciones registradas para este job.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
