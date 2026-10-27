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
  Trash2,
  Clock,
  Globe,
  Layers,
  Briefcase,
  AlertCircle,
  CheckCircle2,
  X,
  Pencil,
  Zap,
  Sparkles,
  Bell,
  Bot,
  SlidersHorizontal,
  ArrowRight,
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

type CreationMode = "template_web" | "template_reminder" | "template_ai" | "advanced";

export default function AutomationsPage() {
  const { workspace } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hideTests, setHideTests] = useState(false);

  // Modal y Modo de Creación
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>("template_web");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Campos Modo Avanzado
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState("");
  const [cronPreset, setCronPreset] = useState("0 9 * * *");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState("America/Santo_Domingo");
  const [concurrencyPolicy, setConcurrencyPolicy] = useState<"allow" | "forbid" | "queue">("forbid");
  const [catchUpPolicy, setCatchUpPolicy] = useState<"limited_catch_up" | "skip" | "catch_up">("limited_catch_up");

  // Plantilla 1: Vigilar sitio web
  const [tplWebName, setTplWebName] = useState("Monitoreo Web");
  const [tplWebUrl, setTplWebUrl] = useState("https://");
  const [tplWebFrequency, setTplWebFrequency] = useState<"15min" | "hourly" | "daily">("hourly");
  const [tplWebCondition, setTplWebCondition] = useState<"content_change" | "downtime">("downtime");

  // Plantilla 2: Recordatorio recurrente
  const [tplReminderName, setTplReminderName] = useState("Recordatorio Diario");
  const [tplReminderMessage, setTplReminderMessage] = useState("");
  const [tplReminderFrequency, setTplReminderFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [tplReminderTime, setTplReminderTime] = useState("09:00");

  // Plantilla 3: Pregunta recurrente a la IA
  const [tplAiName, setTplAiName] = useState("Consulta Diaria a IA");
  const [tplAiPrompt, setTplAiPrompt] = useState("");
  const [tplAiModel, setTplAiModel] = useState<"Gemini Flash" | "Gemini Pro">("Gemini Flash");
  const [tplAiFrequency, setTplAiFrequency] = useState<"hourly" | "daily" | "weekly">("daily");

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

  const openTemplate = (mode: CreationMode) => {
    setCreationMode(mode);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const resolveTargetJobId = async (automationTitle: string, inputData: string): Promise<string> => {
    if (jobId) return jobId;
    if (jobs.length > 0) return jobs[0].id;

    const agentRes = await fetch(`/api/agents?workspaceId=${workspace?.id}`);
    const agentData = await agentRes.json().catch(() => ({}));
    const agentId = agentData.agents?.[0]?.id;

    if (!agentId) {
      throw new Error("No hay agentes disponibles en este workspace para vincular la automatización.");
    }

    const jobRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspace?.id,
        agentId,
        name: `${automationTitle} (Job Base)`,
        description: `Job creado automáticamente para la plantilla "${automationTitle}"`,
        input: inputData,
        timeoutSeconds: 300,
        maxConcurrentRuns: 1,
      }),
    });

    const jobData = await jobRes.json();
    if (!jobRes.ok || !jobData.job?.id) {
      throw new Error(jobData?.error?.message || "Error al crear el Job base para la plantilla.");
    }

    await fetch(`/api/jobs/${jobData.job.id}/activate`, { method: "POST" }).catch(() => {});
    loadJobs();
    return jobData.job.id;
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
      if (!res.ok) throw new Error(data.error?.message || "Error al crear la automatización.");

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

  const handleCreateTemplateWeb = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!tplWebName.trim()) {
      setCreateError("El nombre es obligatorio.");
      return;
    }
    if (!tplWebUrl.trim() || !tplWebUrl.startsWith("http")) {
      setCreateError("Ingresa una URL válida que comience con http:// o https://.");
      return;
    }

    let cron = "0 * * * *";
    if (tplWebFrequency === "15min") cron = "*/15 * * * *";
    else if (tplWebFrequency === "daily") cron = "0 9 * * *";

    const condLabel = tplWebCondition === "content_change" ? "cambie el contenido" : "deje de responder";
    const desc = `Vigilancia web (${tplWebUrl.trim()}) — Alerta cuando ${condLabel}`;

    setIsSubmitting(true);
    try {
      const targetJobId = await resolveTargetJobId(
        tplWebName.trim(),
        JSON.stringify({ task: "web_watch", url: tplWebUrl.trim(), condition: tplWebCondition })
      );

      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          jobId: targetJobId,
          name: tplWebName.trim(),
          description: desc,
          cronExpression: cron,
          timezone,
          concurrencyPolicy: "forbid",
          catchUpPolicy: "limited_catch_up",
          maxCatchUpOccurrences: 2,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error al crear automatización.");

      if (data.automation?.id) {
        await fetch(`/api/automations/${data.automation.id}/activate`, { method: "POST" });
      }

      setIsCreateOpen(false);
      setFeedback({ type: "success", message: `Plantilla "Vigilar sitio web" activada exitosamente para ${tplWebName.trim()}.` });
      loadAutomations();
    } catch (err: any) {
      setCreateError(err?.message || "Error al crear la automatización desde plantilla.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTemplateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!tplReminderName.trim()) {
      setCreateError("El nombre es obligatorio.");
      return;
    }
    if (!tplReminderMessage.trim()) {
      setCreateError("El mensaje del recordatorio es obligatorio.");
      return;
    }

    const timeParts = (tplReminderTime || "09:00").split(":");
    const hours = parseInt(timeParts[0] || "9", 10);
    const minutes = parseInt(timeParts[1] || "0", 10);

    let cron = `${minutes} ${hours} * * *`;
    if (tplReminderFrequency === "weekly") {
      cron = `${minutes} ${hours} * * 1`;
    } else if (tplReminderFrequency === "monthly") {
      cron = `${minutes} ${hours} 1 * *`;
    }

    const desc = `Recordatorio: ${tplReminderMessage.trim()}`;

    setIsSubmitting(true);
    try {
      const targetJobId = await resolveTargetJobId(
        tplReminderName.trim(),
        JSON.stringify({ task: "reminder", message: tplReminderMessage.trim() })
      );

      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          jobId: targetJobId,
          name: tplReminderName.trim(),
          description: desc,
          cronExpression: cron,
          timezone,
          concurrencyPolicy: "forbid",
          catchUpPolicy: "limited_catch_up",
          maxCatchUpOccurrences: 2,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error al crear recordatorio.");

      if (data.automation?.id) {
        await fetch(`/api/automations/${data.automation.id}/activate`, { method: "POST" });
      }

      setIsCreateOpen(false);
      setFeedback({ type: "success", message: `Recordatorio recurrente "${tplReminderName.trim()}" programado exitosamente.` });
      loadAutomations();
    } catch (err: any) {
      setCreateError(err?.message || "Error al crear la automatización desde plantilla.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTemplateAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!tplAiName.trim()) {
      setCreateError("El nombre es obligatorio.");
      return;
    }
    if (!tplAiPrompt.trim()) {
      setCreateError("La instrucción o pregunta para la IA es obligatoria.");
      return;
    }

    let cron = "0 9 * * *";
    if (tplAiFrequency === "hourly") cron = "0 * * * *";
    else if (tplAiFrequency === "weekly") cron = "0 9 * * 1";

    const desc = `Consulta IA (${tplAiModel}): ${tplAiPrompt.trim().slice(0, 90)}`;

    setIsSubmitting(true);
    try {
      const targetJobId = await resolveTargetJobId(
        tplAiName.trim(),
        JSON.stringify({ task: "ai_query", model: tplAiModel, prompt: tplAiPrompt.trim() })
      );

      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          jobId: targetJobId,
          name: tplAiName.trim(),
          description: desc,
          cronExpression: cron,
          timezone,
          concurrencyPolicy: "forbid",
          catchUpPolicy: "limited_catch_up",
          maxCatchUpOccurrences: 2,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error al programar consulta a IA.");

      if (data.automation?.id) {
        await fetch(`/api/automations/${data.automation.id}/activate`, { method: "POST" });
      }

      setIsCreateOpen(false);
      setFeedback({ type: "success", message: `Consulta periódica a la IA "${tplAiName.trim()}" creada con éxito.` });
      loadAutomations();
    } catch (err: any) {
      setCreateError(err?.message || "Error al crear la automatización desde plantilla.");
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

  // Borrado permanente en dos clics, solo en archivadas (las activas o
  // pausadas se archivan primero). El endpoint rechaza con 409 si un job
  // todavía la referencia.
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = async (autoId: string) => {
    if (deleteConfirmId !== autoId) {
      setDeleteConfirmId(autoId);
      return;
    }
    setDeleteConfirmId(null);
    try {
      const res = await fetch(`/api/automations/${autoId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        loadAutomations();
        setFeedback({ type: "success", message: "Automatización eliminada exitosamente." });
      } else {
        setFeedback({ type: "error", message: data.error?.message || `No se pudo eliminar (${res.status}).` });
      }
    } catch {
      setFeedback({ type: "error", message: "No se pudo eliminar la automatización." });
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openTemplate("advanced")}
              className="flex items-center gap-1.5"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Modo Avanzado</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => openTemplate("template_web")}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nueva Automatización
            </Button>
          </div>
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

        {/* SECCIÓN: CREAR DESDE PLANTILLA (GALERÍA SUPERIOR) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-texter-cyan" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono">
                Crear desde plantilla
              </h2>
            </div>
            <span className="text-[11px] text-texter-text-dim">
              Atajos rápidos sin configuración cron
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              variant="elevated"
              className="p-4 space-y-3 border-texter-border hover:border-texter-cyan/50 hover:bg-texter-surface-hover/60 transition-all cursor-pointer group flex flex-col justify-between"
              onClick={() => openTemplate("template_web")}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-texter-cyan/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <Globe className="w-4 h-4" />
                  </div>
                  <Badge variant="cyan" size="sm">Monitoreo</Badge>
                </div>
                <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Vigilar sitio web
                </h3>
                <p className="text-xs text-texter-text-muted leading-relaxed">
                  Supervisa la disponibilidad de una URL o detecta cambios de contenido con comprobaciones periódicas.
                </p>
              </div>
              <div className="pt-2 border-t border-texter-border flex items-center justify-between text-xs text-texter-cyan font-medium">
                <span>Usar plantilla</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Card>

            <Card
              variant="elevated"
              className="p-4 space-y-3 border-texter-border hover:border-indigo-500/50 hover:bg-texter-surface-hover/60 transition-all cursor-pointer group flex flex-col justify-between"
              onClick={() => openTemplate("template_reminder")}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-texter-indigo/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Bell className="w-4 h-4" />
                  </div>
                  <Badge variant="indigo" size="sm">Horario</Badge>
                </div>
                <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                  Recordatorio recurrente
                </h3>
                <p className="text-xs text-texter-text-muted leading-relaxed">
                  Envía alertas y recordatorios a la hora exacta que elijas (diario, semanal o mensual).
                </p>
              </div>
              <div className="pt-2 border-t border-texter-border flex items-center justify-between text-xs text-indigo-400 font-medium">
                <span>Usar plantilla</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Card>

            <Card
              variant="elevated"
              className="p-4 space-y-3 border-texter-border hover:border-emerald-500/50 hover:bg-texter-surface-hover/60 transition-all cursor-pointer group flex flex-col justify-between"
              onClick={() => openTemplate("template_ai")}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Bot className="w-4 h-4" />
                  </div>
                  <Badge variant="success" size="sm">IA LLM</Badge>
                </div>
                <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                  Pregunta recurrente a la IA
                </h3>
                <p className="text-xs text-texter-text-muted leading-relaxed">
                  Genera resúmenes, análisis o reportes automáticos consultando modelos Gemini de forma programada.
                </p>
              </div>
              <div className="pt-2 border-t border-texter-border flex items-center justify-between text-xs text-emerald-400 font-medium">
                <span>Usar plantilla</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Card>
          </div>
        </div>

        {/* Empty State */}
        {automations.length === 0 && !isLoading && (
          <Card variant="elevated" className="text-center py-12 space-y-3">
            <Calendar className="w-10 h-10 text-texter-indigo/60 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No hay automatizaciones configuradas</h3>
            <p className="text-xs text-texter-text-muted max-w-sm mx-auto">
              Elige una plantilla arriba para crear tu primera regla en segundos, o usa el modo avanzado para control cron completo.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => openTemplate("template_web")}
              className="inline-flex items-center gap-1.5 mt-2"
            >
              <Plus className="w-4 h-4" />
              Crear Primera Automatización
            </Button>
          </Card>
        )}

        {/* Lista de Automations */}
        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 text-xs text-texter-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={hideTests}
              onChange={(e) => setHideTests(e.target.checked)}
              className="accent-indigo-500"
            />
            Ocultar pruebas (nombres con TEST o Prueba)
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations
            .filter((auto) => !hideTests || !/test|prueba/i.test(auto.name))
            .map((auto) => (
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
                  {auto.status !== "archived" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStatusChange(auto.id, "archive")}
                      className="text-xs text-texter-text-dim hover:text-rose-400"
                      title="Archivar"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {auto.status === "archived" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(auto.id)}
                      className="text-xs text-texter-text-dim hover:text-rose-400"
                      title={deleteConfirmId === auto.id ? "Pulsa otra vez para confirmar el borrado permanente" : "Eliminar permanentemente"}
                    >
                      {deleteConfirmId === auto.id ? (
                        <span className="text-rose-400 font-semibold">¿Seguro?</span>
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-texter-indigo" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    {creationMode === "template_web" && "Plantilla: Vigilar sitio web"}
                    {creationMode === "template_reminder" && "Plantilla: Recordatorio recurrente"}
                    {creationMode === "template_ai" && "Plantilla: Pregunta recurrente a la IA"}
                    {creationMode === "advanced" && "Crear Nueva Automatización (Modo Avanzado)"}
                  </h2>
                  <p className="text-xs text-texter-text-muted">
                    {creationMode === "advanced"
                      ? "Configuración granular con cron, husos horarios y políticas de overlap"
                      : "Configuración rápida de 2 a 4 campos simples sin expresiones cron"}
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

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-texter-text-dim uppercase tracking-wider">
                Seleccionar Vía de Creación:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => { setCreationMode("template_web"); setCreateError(null); }}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs flex flex-col gap-1 ${
                    creationMode === "template_web"
                      ? "bg-texter-cyan/15 border-cyan-500/50 text-white shadow-sm"
                      : "bg-texter-surface-subtle border-texter-border text-texter-text-secondary hover:text-white hover:border-texter-hover"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Globe className="w-3.5 h-3.5 text-texter-cyan" />
                    Web Watch
                  </span>
                  <span className="text-[10px] text-texter-text-dim line-clamp-1">Vigilar web</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCreationMode("template_reminder"); setCreateError(null); }}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs flex flex-col gap-1 ${
                    creationMode === "template_reminder"
                      ? "bg-texter-indigo/20 border-indigo-500/50 text-white shadow-sm"
                      : "bg-texter-surface-subtle border-texter-border text-texter-text-secondary hover:text-white hover:border-texter-hover"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Bell className="w-3.5 h-3.5 text-texter-indigo" />
                    Recordatorio
                  </span>
                  <span className="text-[10px] text-texter-text-dim line-clamp-1">Por horario</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCreationMode("template_ai"); setCreateError(null); }}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs flex flex-col gap-1 ${
                    creationMode === "template_ai"
                      ? "bg-emerald-500/20 border-emerald-500/50 text-white shadow-sm"
                      : "bg-texter-surface-subtle border-texter-border text-texter-text-secondary hover:text-white hover:border-texter-hover"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Bot className="w-3.5 h-3.5 text-emerald-400" />
                    Pregunta IA
                  </span>
                  <span className="text-[10px] text-texter-text-dim line-clamp-1">Consulta LLM</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCreationMode("advanced"); setCreateError(null); }}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs flex flex-col gap-1 ${
                    creationMode === "advanced"
                      ? "bg-purple-500/20 border-purple-500/50 text-white shadow-sm"
                      : "bg-texter-surface-subtle border-texter-border text-texter-text-secondary hover:text-white hover:border-texter-hover"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400" />
                    Avanzado
                  </span>
                  <span className="text-[10px] text-texter-text-dim line-clamp-1">Cron manual</span>
                </button>
              </div>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            {/* FORMULARIO PLANTILLA 1: VIGILAR SITIO WEB */}
            {creationMode === "template_web" && (
              <form onSubmit={handleCreateTemplateWeb} className="space-y-4 pt-1">
                <Input
                  label="Nombre"
                  value={tplWebName}
                  onChange={(e) => setTplWebName(e.target.value)}
                  placeholder="ej: Monitor de disponibilidad API"
                  required
                />

                <Input
                  label="URL a vigilar"
                  value={tplWebUrl}
                  onChange={(e) => setTplWebUrl(e.target.value)}
                  placeholder="https://ejemplo.com"
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Revisar cada
                    </label>
                    <select
                      value={tplWebFrequency}
                      onChange={(e) => setTplWebFrequency(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                    >
                      <option value="15min">Cada 15 minutos</option>
                      <option value="hourly">Cada hora</option>
                      <option value="daily">Diario (a las 9:00 AM)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Avisar cuando
                    </label>
                    <select
                      value={tplWebCondition}
                      onChange={(e) => setTplWebCondition(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                    >
                      <option value="downtime">Deje de responder</option>
                      <option value="content_change">Cambie el contenido</option>
                    </select>
                  </div>
                </div>

                <div className="pt-3 border-t border-texter-border flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCreationMode("advanced")}
                    className="text-xs text-texter-text-dim hover:text-white underline font-mono"
                  >
                    Personalizar en Modo Avanzado &rarr;
                  </button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="md" type="button" onClick={() => setIsCreateOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" size="md" type="submit" isLoading={isSubmitting}>
                      Crear Automatización
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* FORMULARIO PLANTILLA 2: RECORDATORIO RECURRENTE */}
            {creationMode === "template_reminder" && (
              <form onSubmit={handleCreateTemplateReminder} className="space-y-4 pt-1">
                <Input
                  label="Nombre"
                  value={tplReminderName}
                  onChange={(e) => setTplReminderName(e.target.value)}
                  placeholder="ej: Recordatorio diario de standup"
                  required
                />

                <Input
                  label="Mensaje del recordatorio"
                  value={tplReminderMessage}
                  onChange={(e) => setTplReminderMessage(e.target.value)}
                  placeholder="ej: Revisar métricas y estado de los agentes"
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Frecuencia
                    </label>
                    <select
                      value={tplReminderFrequency}
                      onChange={(e) => setTplReminderFrequency(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                    >
                      <option value="daily">Diario</option>
                      <option value="weekly">Semanal (Lunes)</option>
                      <option value="monthly">Mensual (Día 1)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Hora
                    </label>
                    <input
                      type="time"
                      value={tplReminderTime}
                      onChange={(e) => setTplReminderTime(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                      required
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-texter-border flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCreationMode("advanced")}
                    className="text-xs text-texter-text-dim hover:text-white underline font-mono"
                  >
                    Personalizar en Modo Avanzado &rarr;
                  </button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="md" type="button" onClick={() => setIsCreateOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" size="md" type="submit" isLoading={isSubmitting}>
                      Crear Automatización
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* FORMULARIO PLANTILLA 3: PREGUNTA RECURRENTE A LA IA */}
            {creationMode === "template_ai" && (
              <form onSubmit={handleCreateTemplateAi} className="space-y-4 pt-1">
                <Input
                  label="Nombre"
                  value={tplAiName}
                  onChange={(e) => setTplAiName(e.target.value)}
                  placeholder="ej: Resumen de noticias matutino"
                  required
                />

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">
                    Pregunta o instrucción
                  </label>
                  <textarea
                    value={tplAiPrompt}
                    onChange={(e) => setTplAiPrompt(e.target.value)}
                    placeholder="Describe la tarea o consulta recurrente para la IA..."
                    rows={3}
                    className="w-full p-3 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Modelo
                    </label>
                    <select
                      value={tplAiModel}
                      onChange={(e) => setTplAiModel(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                    >
                      <option value="Gemini Flash">Gemini Flash</option>
                      <option value="Gemini Pro">Gemini Pro</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-texter-text-secondary">
                      Frecuencia
                    </label>
                    <select
                      value={tplAiFrequency}
                      onChange={(e) => setTplAiFrequency(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                    >
                      <option value="hourly">Cada hora</option>
                      <option value="daily">Diario (a las 9:00 AM)</option>
                      <option value="weekly">Semanal (Lunes a las 9:00 AM)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-3 border-t border-texter-border flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCreationMode("advanced")}
                    className="text-xs text-texter-text-dim hover:text-white underline font-mono"
                  >
                    Personalizar en Modo Avanzado &rarr;
                  </button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="md" type="button" onClick={() => setIsCreateOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" size="md" type="submit" isLoading={isSubmitting}>
                      Crear Automatización
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* FORMULARIO MODO AVANZADO (INTACTO) */}
            {creationMode === "advanced" && (
              <form onSubmit={handleCreateAutomation} className="space-y-4 pt-1">
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
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
