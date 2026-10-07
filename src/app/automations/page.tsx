"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { Automation, Job } from "@/lib/jobs/types";
import {
  Calendar,
  Plus,
  Play,
  Pause,
  Archive,
  Clock,
  Globe,
  Layers,
  Briefcase,
  AlertCircle,
  CheckCircle2,
  X,
  Pencil,
  Zap,
} from "lucide-react";
import Link from "next/link";

const CRON_PRESETS = [
  { label: "Cada 1 minuto (* * * * *)", value: "* * * * *" },
  { label: "Cada 5 minutos (*/5 * * * *)", value: "*/5 * * * *" },
  { label: "Cada hora en punto (0 * * * *)", value: "0 * * * *" },
  { label: "Diario a las 9:00 AM (0 9 * * *)", value: "0 9 * * *" },
  { label: "Diario a medianoche (0 0 * * *)", value: "0 0 * * *" },
  { label: "Semanal (Lunes a las 9:00 AM) (0 9 * * 1)", value: "0 9 * * 1" },
  { label: "Mensual (Día 1 a medianoche) (0 0 1 * *)", value: "0 0 1 * *" },
  { label: "Personalizado...", value: "custom" },
];

const TIMEZONES = [
  "America/Santo_Domingo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Bogota",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "America/Santiago",
  "Europe/Madrid",
  "UTC",
];

export default function AutomationsPage() {
  const { workspace } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Crear Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState("");
  const [cronPreset, setCronPreset] = useState("0 9 * * *");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState("America/Santo_Domingo");
  const [concurrencyPolicy, setConcurrencyPolicy] = useState<"allow" | "forbid" | "queue">("forbid");
  const [catchUpPolicy, setCatchUpPolicy] = useState<"limited_catch_up" | "skip" | "catch_up">("limited_catch_up");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (workspace?.id) {
      loadAutomations();
      loadJobs();
    }
  }, [workspace?.id]);

  const loadAutomations = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/automations?workspaceId=${workspace?.id}`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const loadJobs = async () => {
    try {
      const res = await fetch(`/api/jobs?workspaceId=${workspace?.id}`);
      if (res.ok) {
        const data = await res.json();
        const availableJobs = (data.jobs || []).filter((j: Job) => j.status !== "archived");
        setJobs(availableJobs);
        if (availableJobs.length > 0) {
          setJobId((prev) => prev || availableJobs[0].id);
        }
      }
    } catch {
      // Fallback
    }
  };

  const handleCronPresetChange = (preset: string) => {
    setCronPreset(preset);
    if (preset !== "custom") {
      setCronExpression(preset);
    }
  };

  const handleCreateAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!name.trim()) {
      setCreateError("El nombre de la automatización es obligatorio.");
      return;
    }
    if (!jobId) {
      setCreateError("Debes vincular un Job a la automatización.");
      return;
    }
    if (!cronExpression.trim()) {
      setCreateError("La expresión Cron es obligatoria.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          jobId,
          name: name.trim(),
          description: description.trim() || undefined,
          cronExpression: cronExpression.trim(),
          timezone,
          concurrencyPolicy,
          catchUpPolicy,
          maxCatchUpOccurrences: 2,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al crear la automatización.");
      }

      // Activar automáticamente la nueva automatización
      if (data.automation?.id) {
        await fetch(`/api/automations/${data.automation.id}/activate`, { method: "POST" });
      }

      setIsCreateOpen(false);
      setName("");
      setDescription("");
      setCronPreset("0 9 * * *");
      setCronExpression("0 9 * * *");
      setFeedback({ type: "success", message: `Automatización "${name.trim()}" creada y activada correctamente.` });
      loadAutomations();
    } catch (err: any) {
      setCreateError(err?.message || "Ocurrió un error inesperado al registrar la automatización.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (autoId: string, action: "activate" | "pause" | "archive") => {
    try {
      const res = await fetch(`/api/automations/${autoId}/${action}`, { method: "POST" });
      if (res.ok) {
        loadAutomations();
        setFeedback({
          type: "success",
          message: `Automatización ${action === "activate" ? "activada" : action === "pause" ? "pausada" : "archivada"} exitosamente.`,
        });
      }
    } catch {
      // Error
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success" size="sm" dot>Activa</Badge>;
      case "paused":
        return <Badge variant="warning" size="sm" dot>Pausada</Badge>;
      case "archived":
        return <Badge variant="default" size="sm" dot>Archivada</Badge>;
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
              <Calendar className="w-6 h-6 text-texter-indigo" />
              Programaciones Autónomas (Automations)
            </h1>
            <p className="text-xs text-texter-text-muted mt-1">
              Ejecución programada de jobs con soporte para husos horarios IANA, transiciones DST y políticas de overlap.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nueva Automatización
          </Button>
        </div>

        {/* Notificaciones */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <span className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose" />
              )}
              {feedback.message}
            </span>
            <button onClick={() => setFeedback(null)} className="text-texter-text-dim hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Empty State */}
        {automations.length === 0 && !isLoading && (
          <Card variant="elevated" className="text-center py-12 space-y-3">
            <Calendar className="w-10 h-10 text-texter-indigo/60 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No hay automatizaciones configuradas</h3>
            <p className="text-xs text-texter-text-muted max-w-sm mx-auto">
              Crea tu primera regla programada para ejecutar automáticamente tus Jobs y agentes recurrentemente por tiempo o cron.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 mt-2"
            >
              <Plus className="w-4 h-4" />
              Crear Primera Automatización
            </Button>
          </Card>
        )}

        {/* Lista de Automations */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations.map((auto) => (
            <Card key={auto.id} variant="elevated" className="space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-white text-base">{auto.name}</h3>
                  <p className="text-xs text-texter-text-muted line-clamp-1">{auto.description || "Sin descripción"}</p>
                </div>
                {getStatusBadge(auto.status)}
              </div>

              <div className="text-xs font-mono bg-texter-surface-subtle p-2.5 rounded border border-texter-border space-y-1.5">
                <div className="flex justify-between text-texter-text-dim">
                  <span>Regla Cron:</span>
                  <span className="text-texter-cyan font-bold">{auto.cron_expression}</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Huso Horario:</span>
                  <span className="text-white flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {auto.timezone}
                  </span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Overlap:</span>
                  <span className="text-white uppercase">{auto.concurrency_policy}</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Catch-up:</span>
                  <span className="text-white">{auto.catch_up_policy} (máx {auto.max_catch_up_occurrences})</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-texter-border">
                <div className="flex items-center gap-1.5">
                  {auto.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStatusChange(auto.id, "pause")}
                      className="text-xs text-texter-text-muted hover:text-white flex items-center gap-1"
                      title="Pausar Automatización"
                    >
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                      <span>Pausar</span>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange(auto.id, "activate")}
                      className="text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 flex items-center gap-1"
                      title="Activar Automatización"
                    >
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Activar</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleStatusChange(auto.id, "archive")}
                    className="text-xs text-texter-text-dim hover:text-rose-400"
                    title="Archivar"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <span className="text-[11px] text-texter-text-dim flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3 text-texter-indigo" />
                  {auto.next_scheduled_at ? new Date(auto.next_scheduled_at).toLocaleTimeString() : "Pendiente"}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* MODAL CREAR AUTOMATIZACIÓN */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-texter-indigo" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Crear Nueva Automatización
                  </h2>
                  <p className="text-xs text-texter-text-muted">
                    Programa la ejecución recurrente de un Job y su agente asociado
                  </p>
                </div>
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

            <form onSubmit={handleCreateAutomation} className="space-y-4">
              <Input
                label="Nombre de la Automatización"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Sincronización Nocturna Diaria"
                required
              />

              <Input
                label="Descripción (opcional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve propósito de la programación"
              />

              {/* Vincular Job */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Job a Vincular & Ejecutar
                </label>
                {jobs.length === 0 ? (
                  <div className="p-3 rounded-xl bg-texter-surface-subtle border border-amber-500/40 text-xs text-amber-300 flex items-center justify-between">
                    <span>No tienes Jobs creados en este workspace.</span>
                    <Link
                      href="/jobs"
                      className="text-texter-indigo hover:underline font-semibold ml-2"
                    >
                      Crear Job &rarr;
                    </Link>
                  </div>
                ) : (
                  <select
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    <option value="" disabled>
                      Selecciona un Job...
                    </option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name} ({j.status.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Frecuencia Cron con Presets */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Frecuencia de Disparo (Regla Cron)
                </label>
                <select
                  value={cronPreset}
                  onChange={(e) => handleCronPresetChange(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>

                {cronPreset === "custom" && (
                  <Input
                    label="Expresión Cron Estándar (5 campos: min hora día mes día_sem)"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="ej: */15 * * * *"
                    className="font-mono text-xs"
                    required
                  />
                )}
              </div>

              {/* Huso Horario y Políticas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">
                    Huso Horario (Timezone)
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">
                    Política de Solapamiento (Overlap)
                  </label>
                  <select
                    value={concurrencyPolicy}
                    onChange={(e) => setConcurrencyPolicy(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    <option value="forbid">Forbid (Saltar si hay uno en curso)</option>
                    <option value="queue">Queue (Encolar en espera)</option>
                    <option value="allow">Allow (Ejecutar concurrente)</option>
                  </select>
                </div>
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
                  disabled={isSubmitting || jobs.length === 0}
                >
                  Crear Automatización
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
