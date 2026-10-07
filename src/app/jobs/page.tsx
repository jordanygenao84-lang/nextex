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
  Terminal,
  AlertCircle,
  CheckCircle2,
  X,
  Pencil,
} from "lucide-react";

export default function JobsPage() {
  const { workspace } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [agents, setAgents] = useState<{ id: string; name: string; model_id?: string }[]>([]);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Crear Job Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [input, setInput] = useState("");
  const [agentId, setAgentId] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Editar Job Modal
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editInput, setEditInput] = useState("");
  const [editTimeoutSeconds, setEditTimeoutSeconds] = useState(300);
  const [editMaxConcurrentRuns, setEditMaxConcurrentRuns] = useState(1);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace?.id) {
      loadJobs();
      loadAgents();
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

  const loadAgents = async () => {
    try {
      const res = await fetch(`/api/agents?workspaceId=${workspace?.id}`);
      if (res.ok) {
        const data = await res.json();
        const loaded = data.agents || [];
        setAgents(loaded);
        if (loaded.length > 0) {
          setAgentId((prev) => prev || loaded[0].id);
        }
      }
    } catch {
      // Fallback
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
    setCreateError(null);

    if (!name.trim()) {
      setCreateError("El nombre del Job es obligatorio.");
      return;
    }
    if (!agentId) {
      setCreateError("Debes seleccionar un agente.");
      return;
    }
    if (!input.trim()) {
      setCreateError("El input o payload inicial es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          agentId,
          name: name.trim(),
          description: description.trim() || undefined,
          input: input.trim(),
          timeoutSeconds: Number(timeoutSeconds),
          maxConcurrentRuns: Number(maxConcurrentRuns),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al crear el Job.");
      }

      // Activar automáticamente el job recién creado
      if (data.job?.id && data.job?.status !== "active") {
        await fetch(`/api/jobs/${data.job.id}/activate`, { method: "POST" });
      }

      setIsCreateOpen(false);
      setName("");
      setDescription("");
      setInput("");
      setCreateError(null);
      setActionSuccess(`Job "${name.trim()}" creado y activado exitosamente.`);
      loadJobs();
    } catch (err: any) {
      setCreateError(err?.message || "Ocurrió un error inesperado al crear el Job.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (job: Job) => {
    setEditingJob(job);
    setEditName(job.name);
    setEditDescription(job.description || "");
    setEditInput(job.input);
    setEditTimeoutSeconds(job.timeout_seconds);
    setEditMaxConcurrentRuns(job.max_concurrent_runs);
    setEditError(null);
  };

  const handleUpdateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJob) return;
    setEditError(null);

    if (!editName.trim()) {
      setEditError("El nombre del Job es obligatorio.");
      return;
    }
    if (!editInput.trim()) {
      setEditError("El input o payload es obligatorio.");
      return;
    }

    setIsEditSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${editingJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          input: editInput.trim(),
          timeout_seconds: Number(editTimeoutSeconds),
          max_concurrent_runs: Number(editMaxConcurrentRuns),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al actualizar el Job.");
      }

      setEditingJob(null);
      setActionSuccess(`Job "${editName.trim()}" actualizado correctamente.`);
      loadJobs();
    } catch (err: any) {
      setEditError(err?.message || "Ocurrió un error al actualizar el Job.");
    } finally {
      setIsEditSubmitting(false);
    }
  };

  const handleTriggerRun = async (job: Job) => {
    setRunningJobId(job.id);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (job.status !== "active") {
        const actRes = await fetch(`/api/jobs/${job.id}/activate`, { method: "POST" });
        if (!actRes.ok) {
          const actData = await actRes.json();
          throw new Error(actData.error?.message || "No se pudo activar el Job.");
        }
        await loadJobs();
      }
      const res = await fetch(`/api/jobs/${job.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al disparar la ejecución del Job.");
      }

      setSelectedJob(job);
      await loadJobRuns(job.id);
      setActionSuccess(`Ejecución disparada exitosamente para "${job.name}".`);
    } catch (err: any) {
      setActionError(err?.message || "Ocurrió un error al ejecutar el Job.");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleStatusChange = async (jobId: string, action: "activate" | "pause" | "archive") => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/${action}`, { method: "POST" });
      if (res.ok) {
        loadJobs();
        setActionSuccess(`Job ${action === "activate" ? "activado" : action === "pause" ? "pausado" : "archivado"} con éxito.`);
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

        {/* Notificaciones */}
        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              {actionSuccess}
            </span>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {actionError && (
          <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              {actionError}
            </span>
            <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Empty State */}
        {jobs.length === 0 && !isLoading && (
          <Card variant="elevated" className="text-center py-12 space-y-3">
            <Briefcase className="w-10 h-10 text-texter-indigo/60 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No hay Jobs creados</h3>
            <p className="text-xs text-texter-text-muted max-w-sm mx-auto">
              Crea tu primer Job autónomo durable para orquestar ejecuciones asíncronas con reintentos y control de concurrencia.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 mt-2"
            >
              <Plus className="w-4 h-4" />
              Nuevo Job
            </Button>
          </Card>
        )}

        {/* Lista de Jobs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <Card key={job.id} variant="elevated" className="space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
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
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-texter-border mt-3">
                <div className="flex items-center gap-1">
                  {job.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStatusChange(job.id, "pause")}
                      className="text-xs text-texter-text-muted hover:text-white flex items-center gap-1"
                      title="Pausar Job"
                    >
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                      <span>Pausar</span>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange(job.id, "activate")}
                      className="text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 flex items-center gap-1"
                      title="Activar Job"
                    >
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Activar</span>
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(job)}
                    className="text-xs text-texter-cyan hover:text-white flex items-center gap-1"
                    title="Editar Job"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleStatusChange(job.id, "archive")}
                    className="text-xs text-texter-text-dim hover:text-rose-400"
                    title="Archivar Job"
                  >
                    <Archive className="w-3.5 h-3.5" />
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
                    disabled={job.status === "archived" || runningJobId === job.id}
                    isLoading={runningJobId === job.id}
                    onClick={() => handleTriggerRun(job)}
                    className="flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    {job.status === "active" ? "Ejecutar" : "Activar y Ejecutar"}
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

      {/* Modal Crear Job */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-texter-indigo" />
                <h2 className="text-base font-bold text-white">
                  Crear Nuevo Job Autónomo
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setCreateError(null);
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateJob} className="space-y-4">
              <Input
                label="Nombre del Job"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Sincronización de datos o auditoría"
                required
              />

              <Input
                label="Descripción (opcional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve propósito del trabajo"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Agente Asignado
                </label>
                {agents.length === 0 ? (
                  <div className="p-3 rounded-xl bg-texter-surface-subtle border border-amber-500/40 text-xs text-amber-300 flex items-center justify-between">
                    <span>No tienes agentes creados en este workspace.</span>
                    <a
                      href="/agents"
                      className="text-texter-indigo hover:underline font-semibold ml-2"
                    >
                      Crear Agente &rarr;
                    </a>
                  </div>
                ) : (
                  <select
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    <option value="" disabled>
                      Selecciona un agente...
                    </option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.model_id || "default"})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Input / Payload Inicial del Job
                </label>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder='ej: { "task": "run_audit", "batch_size": 50 }'
                  rows={3}
                  required
                  className="w-full p-3 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Timeout (segundos)"
                  type="number"
                  value={timeoutSeconds.toString()}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  min={10}
                  max={3600}
                />

                <Input
                  label="Concurrencia Máxima"
                  type="number"
                  value={maxConcurrentRuns.toString()}
                  onChange={(e) => setMaxConcurrentRuns(Number(e.target.value))}
                  min={1}
                  max={10}
                />
              </div>

              <div className="pt-3 border-t border-texter-border flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="md"
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreateError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  isLoading={isSubmitting}
                  disabled={isSubmitting || agents.length === 0}
                >
                  Crear Job
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Job */}
      {editingJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-texter-cyan" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Modificar Configuración de Job
                  </h2>
                  <p className="text-xs text-texter-text-muted font-mono">
                    ID: {editingJob.id.substring(0, 8)}... • Versión actual: v{editingJob.configuration_version}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingJob(null)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateJob} className="space-y-4">
              <Input
                label="Nombre del Job"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />

              <Input
                label="Descripción (opcional)"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Breve propósito del trabajo"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Input / Payload Inicial del Job
                </label>
                <textarea
                  value={editInput}
                  onChange={(e) => setEditInput(e.target.value)}
                  rows={4}
                  required
                  className="w-full p-3 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Timeout (segundos)"
                  type="number"
                  value={editTimeoutSeconds.toString()}
                  onChange={(e) => setEditTimeoutSeconds(Number(e.target.value))}
                  min={10}
                  max={3600}
                />

                <Input
                  label="Concurrencia Máxima"
                  type="number"
                  value={editMaxConcurrentRuns.toString()}
                  onChange={(e) => setEditMaxConcurrentRuns(Number(e.target.value))}
                  min={1}
                  max={10}
                />
              </div>

              <div className="pt-3 border-t border-texter-border flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="md"
                  type="button"
                  onClick={() => setEditingJob(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  isLoading={isEditSubmitting}
                >
                  Guardar Modificaciones
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
