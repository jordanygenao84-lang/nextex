"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import {
  Gauge,
  Server,
  Activity,
  Plus,
  Play,
  X,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Ban,
  Clock,
  ExternalLink,
  Zap,
  Terminal,
  Globe,
  BarChart3,
  ShieldCheck,
  Info,
} from "lucide-react";

interface FleetAgent {
  id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  capabilities: {
    max_vus?: number;
    engines?: string[];
  };
  created_at: string;
  is_online?: boolean;
  current_job?: {
    id: string;
    name: string;
    target_url: string;
    vus: number;
    started_at: string;
  } | null;
}

interface FleetJob {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  name: string;
  target_url: string;
  vus: number;
  duration_seconds: number;
  rampup_seconds: number;
  scenario: any;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  created_by?: string;
  started_at: string | null;
  finished_at: string | null;
  summary: any | null;
  error: string | null;
  created_at: string;
  fleet_agents?: {
    id: string;
    name: string;
  } | null;
}

interface FleetMetric {
  id?: number;
  job_id: string;
  ts: string;
  vus: number;
  rps: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  errors: number;
}

function formatMs(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} ms`;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Nunca";
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 0) return "En el futuro";
  if (diffSec < 10) return "hace unos segundos";
  if (diffSec < 60) return `hace ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays}d`;
}

function extractHostname(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return url.hostname;
  } catch {
    return urlStr;
  }
}

export default function FleetPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Estados principales
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [jobs, setJobs] = useState<FleetJob[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);

  // Notificaciones globales
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Modal Registro de Agente
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentMaxVus, setAgentMaxVus] = useState(5000);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registeredApiKey, setRegisteredApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // 2. Formulario Nuevo Test
  const [testName, setTestName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [vus, setVus] = useState(50);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [rampupSeconds, setRampupSeconds] = useState(60);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const [createJobError, setCreateJobError] = useState<string | null>(null);

  // 3 & 4. Detalle y Métricas en Vivo
  const [selectedJob, setSelectedJob] = useState<FleetJob | null>(null);
  const [jobMetrics, setJobMetrics] = useState<FleetMetric[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [cancelModalJob, setCancelModalJob] = useState<FleetJob | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Protección de ruta de cliente
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/fleet");
    }
  }, [user, isAuthLoading, router]);

  const loadAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const res = await fetch("/api/fleet/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch (err: any) {
      console.error("Error al cargar agentes:", err);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      setIsLoadingJobs(true);
      const res = await fetch("/api/fleet/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (err: any) {
      console.error("Error al cargar trabajos:", err);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadAgents();
      loadJobs();
    }
  }, [user, loadAgents, loadJobs]);

  // Cargar métricas al seleccionar job
  const loadJobDetail = useCallback(async (jobId: string) => {
    try {
      setIsLoadingMetrics(true);
      const res = await fetch(`/api/fleet/jobs/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.job) setSelectedJob(data.job);
        if (Array.isArray(data.metrics)) setJobMetrics(data.metrics);
      }
    } catch (err) {
      console.error("Error al cargar detalle del job:", err);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, []);

  // Polling cada 5 segundos mientras el trabajo esté en 'queued' o 'running'
  useEffect(() => {
    if (!selectedJob) return;

    const isTerminal = ["completed", "failed", "cancelled"].includes(selectedJob.status);
    if (isTerminal) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/fleet/jobs/${selectedJob.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.job) {
            setSelectedJob(data.job);
            // Actualizar también en la lista de jobs
            setJobs((prev) => prev.map((j) => (j.id === data.job.id ? { ...j, ...data.job } : j)));
          }
          if (Array.isArray(data.metrics)) {
            setJobMetrics(data.metrics);
          }
        }
      } catch (err) {
        console.error("Error en polling de métricas:", err);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [selectedJob?.id, selectedJob?.status]);

  // Manejo de Registro de Agente
  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;

    setIsRegistering(true);
    setRegisterError(null);
    try {
      const res = await fetch("/api/fleet/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName.trim(),
          capabilities: { max_vus: Number(agentMaxVus) || 5000, engines: ["http"] },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegisterError(data?.error?.message || "Error al registrar el agente.");
        return;
      }

      setRegisteredApiKey(data.api_key);
      setAgentName("");
      setAgentMaxVus(5000);
      loadAgents();
    } catch (err: any) {
      setRegisterError(err?.message || "Ocurrió un error inesperado al registrar el agente.");
    } finally {
      setIsRegistering(false);
    }
  };

  // Manejo de Creación de Job
  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateJobError(null);
    setActionError(null);
    setActionSuccess(null);

    // Validación cliente
    if (!testName.trim()) {
      setCreateJobError("El nombre del test es obligatorio.");
      return;
    }
    if (!targetUrl.trim() || !targetUrl.startsWith("http")) {
      setCreateJobError("Ingresa una URL válida que comience con http:// o https://.");
      return;
    }
    const vusNum = Number(vus);
    if (isNaN(vusNum) || vusNum < 1 || vusNum > 100000) {
      setCreateJobError("Los VUs deben ser un número entre 1 y 100,000.");
      return;
    }
    const durationNum = Number(durationSeconds);
    if (isNaN(durationNum) || durationNum < 1 || durationNum > 3600) {
      setCreateJobError("La duración debe ser entre 1 y 3600 segundos (máximo 1 hora).");
      return;
    }
    const rampupNum = Number(rampupSeconds);
    if (isNaN(rampupNum) || rampupNum < 0) {
      setCreateJobError("El tiempo de ramp-up no puede ser negativo.");
      return;
    }

    setIsSubmittingJob(true);
    try {
      const res = await fetch("/api/fleet/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: testName.trim(),
          target_url: targetUrl.trim(),
          vus: vusNum,
          duration_seconds: durationNum,
          rampup_seconds: rampupNum,
          agent_id: selectedAgentId || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateJobError(data?.error?.message || "Error al programar la prueba de carga.");
        return;
      }

      setActionSuccess(`Trabajo "${data.job.name}" encolado exitosamente.`);
      setTestName("");
      setTargetUrl("");
      setVus(50);
      setDurationSeconds(60);
      setRampupSeconds(60);
      setSelectedAgentId("");

      await loadJobs();
      if (data.job) {
        setSelectedJob(data.job);
        loadJobDetail(data.job.id);
      }
    } catch (err: any) {
      setCreateJobError(err?.message || "Ocurrió un error inesperado al crear el trabajo.");
    } finally {
      setIsSubmittingJob(false);
    }
  };

  // Manejo de Cancelación de Job
  const handleConfirmCancel = async () => {
    if (!cancelModalJob) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/fleet/jobs/${cancelModalJob.id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data?.error?.message || "No se pudo cancelar el trabajo.");
      } else {
        setActionSuccess(`Trabajo "${cancelModalJob.name}" cancelado correctamente.`);
        if (selectedJob && selectedJob.id === cancelModalJob.id) {
          setSelectedJob({ ...selectedJob, status: "cancelled" });
        }
        loadJobs();
      }
    } catch (err: any) {
      setActionError(err?.message || "Error al cancelar el trabajo.");
    } finally {
      setIsCancelling(false);
      setCancelModalJob(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const getAgentStatusBadge = (agent: FleetAgent) => {
    if (agent.status === "busy" || agent.current_job) {
      return <Badge variant="cyan" size="sm" dot>Ocupado</Badge>;
    }
    if (agent.is_online || agent.status === "online") {
      return <Badge variant="success" size="sm" dot>Online</Badge>;
    }
    return <Badge variant="default" size="sm" dot>Offline</Badge>;
  };

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case "queued":
        return <Badge variant="warning" size="sm" dot>En cola</Badge>;
      case "running":
        return <Badge variant="cyan" size="sm" dot>En ejecución</Badge>;
      case "completed":
        return <Badge variant="success" size="sm" dot>Completado</Badge>;
      case "failed":
        return <Badge variant="danger" size="sm" dot>Fallido</Badge>;
      case "cancelled":
        return <Badge variant="default" size="sm" dot>Cancelado</Badge>;
      default:
        return <Badge variant="default" size="sm" dot>{status}</Badge>;
    }
  };

  const latestMetric = jobMetrics.length > 0 ? jobMetrics[jobMetrics.length - 1] : null;

  // El resumen final guarda los percentiles como p50_ms/p95_ms/p99_ms (no
  // p50/p95/p99): leer el nombre real primero para no caer al último punto
  // en vivo mientras la etiqueta dice "agregado final" (bug verificado
  // 2026-10-27: P50 107 vs 113.12 del JSON por leer el campo equivocado).
  const summaryP50 = selectedJob?.summary?.p50_ms ?? selectedJob?.summary?.p50 ?? null;
  const summaryP95 = selectedJob?.summary?.p95_ms ?? selectedJob?.summary?.p95 ?? null;
  const summaryP99 = selectedJob?.summary?.p99_ms ?? selectedJob?.summary?.p99 ?? null;
  const summaryErrors = selectedJob?.summary?.total_errors ?? null;

  return (
    <DashboardShell
      title="Flota de Pruebas de Carga (Load Fleet)"
      subtitle="Coordinación distribuida de agentes de estrés, generación de VUs masivos y telemetría en tiempo real"
    >
      <div className="space-y-6">
        {/* Banner de Notificaciones Globales */}
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

        {/* 1. SECCIÓN: TARJETA DE AGENTES */}
        <Card variant="elevated" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-texter-border pb-4">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-texter-cyan" />
              <div>
                <h2 className="text-base font-bold text-white">Agentes de Ejecución</h2>
                <p className="text-xs text-texter-text-muted">
                  Nodos remotos conectados mediante heartbeat seguro (Mac, VPS Oracle, etc.)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadAgents} disabled={isLoadingAgents}>
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAgents ? "animate-spin" : ""}`} />
                <span>Refrescar</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setIsRegisterOpen(true);
                  setRegisterError(null);
                  setRegisteredApiKey(null);
                }}
                className="flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Registrar Agente
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                <tr>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Último Heartbeat</th>
                  <th className="p-3">Capacidad Máxima</th>
                  <th className="p-3">Trabajo Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50">
                {agents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                    <td className="p-3 font-semibold text-white flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-texter-indigo" />
                      {agent.name}
                    </td>
                    <td className="p-3">{getAgentStatusBadge(agent)}</td>
                    <td className="p-3 font-mono text-texter-text-muted">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-texter-text-dim" />
                        {formatRelativeTime(agent.last_seen_at)}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-texter-cyan">
                      {(agent.capabilities?.max_vus || 5000).toLocaleString()} VUs
                    </td>
                    <td className="p-3 font-mono text-texter-text-dim">
                      {agent.current_job ? (
                        <span className="text-texter-cyan">
                          {agent.current_job.name} ({agent.current_job.vus} VUs)
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {agents.length === 0 && !isLoadingAgents && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-texter-text-dim">
                      No hay agentes de flota registrados. Haz clic en "Registrar Agente" para vincular un nodo de ejecución.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 2. SECCIÓN: FORMULARIO NUEVO TEST */}
        <Card variant="elevated" className="space-y-4">
          <div className="flex items-center gap-2.5 border-b border-texter-border pb-3">
            <Gauge className="w-5 h-5 text-texter-indigo" />
            <div>
              <h2 className="text-base font-bold text-white">Lanzar Nueva Prueba de Carga</h2>
              <p className="text-xs text-texter-text-muted">
                Configura los parámetros de concurrencia para inyectar tráfico hacia destinos autorizados
              </p>
            </div>
          </div>

          {createJobError && (
            <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
              <span>{createJobError}</span>
            </div>
          )}

          <form onSubmit={handleCreateJob} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nombre del Test"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="ej: Test de pico Black Friday"
                required
              />

              <div>
                <Input
                  label="URL Objetivo"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://nextex-seven.vercel.app/api/health"
                  required
                />
                <span className="text-[11px] text-texter-text-dim flex items-center gap-1 mt-1 font-mono">
                  <ShieldCheck className="w-3 h-3 text-texter-emerald" />
                  Solo dominios en la allowlist de seguridad
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input
                label="VUs (Usuarios Concurrentes)"
                type="number"
                min={1}
                max={100000}
                value={vus.toString()}
                onChange={(e) => setVus(Number(e.target.value))}
                required
              />

              <Input
                label="Duración (segundos)"
                type="number"
                min={1}
                max={3600}
                value={durationSeconds.toString()}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                hint="Máx 3600s (1h)"
                required
              />

              <Input
                label="Ramp-up (segundos)"
                type="number"
                min={0}
                value={rampupSeconds.toString()}
                onChange={(e) => setRampupSeconds(Number(e.target.value))}
                hint="Escalado gradual"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Agente Asignado
                </label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                >
                  <option value="">Automático (primer agente libre y online)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.capabilities?.max_vus || 5000} VUs) {a.status === "online" ? "• Online" : "• Offline (no elegible en automático)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-texter-border">
              <Button
                variant="primary"
                size="md"
                type="submit"
                isLoading={isSubmittingJob}
                className="flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                <span>Encolar Prueba de Carga</span>
              </Button>
            </div>
          </form>
        </Card>

        {/* 3. SECCIÓN: TABLA DE TRABAJOS */}
        <Card variant="elevated" className="space-y-4">
          <div className="flex justify-between items-center border-b border-texter-border pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-texter-emerald" />
              <h2 className="text-base font-bold text-white">Historial de Pruebas de Carga</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={loadJobs} disabled={isLoadingJobs}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingJobs ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                <tr>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Objetivo</th>
                  <th className="p-3">VUs</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Agente</th>
                  <th className="p-3">Tiempo</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50">
                {jobs.map((job) => {
                  const canCancel = job.status === "queued" || job.status === "running";
                  return (
                    <tr key={job.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="p-3 font-semibold text-white">{job.name}</td>
                      <td className="p-3 font-mono text-texter-cyan flex items-center gap-1">
                        <Globe className="w-3 h-3 text-texter-text-dim shrink-0" />
                        <span className="truncate max-w-[180px]" title={job.target_url}>
                          {extractHostname(job.target_url)}
                        </span>
                      </td>
                      <td className="p-3 font-mono">{job.vus.toLocaleString()}</td>
                      <td className="p-3">{getJobStatusBadge(job.status)}</td>
                      <td className="p-3 font-mono text-texter-text-muted">
                        {job.agent_name || job.fleet_agents?.name || "Automático"}
                      </td>
                      <td className="p-3 font-mono text-texter-text-dim text-[11px]">
                        {job.started_at ? formatRelativeTime(job.started_at) : formatRelativeTime(job.created_at)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedJob(job);
                              loadJobDetail(job.id);
                            }}
                            className="flex items-center gap-1 text-[11px] h-7"
                          >
                            <BarChart3 className="w-3 h-3 text-texter-cyan" />
                            Ver
                          </Button>
                          {canCancel && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setCancelModalJob(job)}
                              className="text-[11px] h-7 px-2"
                              title="Cancelar ejecución"
                            >
                              <Ban className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {jobs.length === 0 && !isLoadingJobs && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-texter-text-dim">
                      No hay trabajos de prueba en cola ni completados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 4. SECCIÓN: DETALLE DEL JOB & MÉTRICAS EN VIVO */}
        {selectedJob && (
          <Card variant="elevated" className="space-y-5 border-texter-indigo/40 bg-texter-surface">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-texter-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{selectedJob.name}</h3>
                  {getJobStatusBadge(selectedJob.status)}
                  {selectedJob.status === "running" && (
                    <span className="text-[10px] text-texter-cyan animate-pulse font-mono flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-texter-cyan animate-ping" />
                      Polling en vivo (5s)
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-texter-text-muted mt-1 truncate">
                  Target: <span className="text-texter-cyan">{selectedJob.target_url}</span> • Agente:{" "}
                  {selectedJob.agent_name || "Asignación automática"} • ID: {selectedJob.id}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(selectedJob.status === "queued" || selectedJob.status === "running") && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setCancelModalJob(selectedJob)}
                    className="flex items-center gap-1 text-xs"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Cancelar Trabajo
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}>
                  Cerrar
                </Button>
              </div>
            </div>

            {/* Error si el job falló */}
            {selectedJob.error && (
              <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 font-mono flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>Error del trabajo: {selectedJob.error}</span>
              </div>
            )}

            {/* Tarjetas de Métricas: si el trabajo terminó y tiene resumen
                final, las tarjetas muestran el AGREGADO de toda la corrida
                (los mismos números del JSON de abajo); si sigue en curso,
                muestran el ÚLTIMO punto en vivo. Antes mezclaba ambos sin
                decirlo y los números no coincidían con el resumen. */}
            <div className="text-[11px] text-texter-text-dim font-mono -mb-1">
              {selectedJob.summary && summaryP50 != null
                ? "Agregado final de la corrida (coincide con el resumen JSON de abajo)"
                : selectedJob.summary
                  ? "Resumen final (los percentiles son el último punto en vivo)"
                  : "Último punto de telemetría en vivo"}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">VUs Pico</span>
                <p className="text-xl font-bold font-mono text-white mt-1">
                  {jobMetrics.length > 0
                    ? Math.max(...jobMetrics.map((m) => m.vus ?? 0), selectedJob.vus ?? 0)
                    : (selectedJob.vus ?? "—")}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">RPS</span>
                <p className="text-xl font-bold font-mono text-texter-cyan mt-1">
                  {selectedJob.summary?.avg_rps ?? latestMetric?.rps ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">p50</span>
                <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                  {summaryP50 != null ? `${Number(summaryP50.toFixed(2))} ms` : formatMs(latestMetric?.p50_ms)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">p95</span>
                <p className="text-xl font-bold font-mono text-amber-400 mt-1">
                  {summaryP95 != null ? `${Number(summaryP95.toFixed(2))} ms` : formatMs(latestMetric?.p95_ms)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">p99</span>
                <p className="text-xl font-bold font-mono text-rose-400 mt-1">
                  {summaryP99 != null ? `${Number(summaryP99.toFixed(2))} ms` : formatMs(latestMetric?.p99_ms)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                <span className="text-[11px] text-texter-text-muted uppercase font-mono">Errores</span>
                <p className="text-xl font-bold font-mono text-texter-rose mt-1">
                  {summaryErrors ?? latestMetric?.errors ?? 0}
                </p>
              </div>
            </div>

            {/* Tabla de los últimos puntos recibidos */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-texter-text-secondary uppercase tracking-wider font-mono">
                Telemetría en Vivo (Últimos Puntos)
              </h4>
              <div className="overflow-x-auto max-h-60 overflow-y-auto border border-texter-border rounded-xl">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border sticky top-0">
                    <tr>
                      <th className="p-2.5">Timestamp</th>
                      <th className="p-2.5">VUs</th>
                      <th className="p-2.5">RPS</th>
                      <th className="p-2.5">p95</th>
                      <th className="p-2.5">Errores</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/40">
                    {[...jobMetrics].reverse().map((m, idx) => (
                      <tr key={m.id || idx} className="hover:bg-texter-surface-hover/40">
                        <td className="p-2.5 text-texter-text-muted">
                          {new Date(m.ts).toLocaleTimeString()}
                        </td>
                        <td className="p-2.5 text-white">{m.vus}</td>
                        <td className="p-2.5 text-texter-cyan">{m.rps}</td>
                        <td className="p-2.5 text-amber-300">{formatMs(m.p95_ms)}</td>
                        <td className="p-2.5 text-texter-rose">{m.errors}</td>
                      </tr>
                    ))}
                    {jobMetrics.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-texter-text-dim">
                          {selectedJob.summary
                            ? "Telemetría en vivo no conservada para esta corrida; ver el resumen final abajo."
                            : "Aún no se han recibido métricas para este trabajo."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Resumen Formateado al Terminar */}
            {selectedJob.summary && (
              <div className="space-y-2 pt-2 border-t border-texter-border">
                <h4 className="text-xs font-semibold text-texter-text-secondary uppercase tracking-wider font-mono">
                  Resumen Final de Rendimiento (Summary)
                </h4>
                <pre className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border font-mono text-xs text-texter-cyan overflow-x-auto">
                  {JSON.stringify(selectedJob.summary, null, 2)}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* MODAL: REGISTRAR AGENTE */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            {!registeredApiKey ? (
              <>
                <div className="flex items-center justify-between border-b border-texter-border pb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-texter-cyan" />
                    <h3 className="text-base font-bold text-white">Registrar Agente de Flota</h3>
                  </div>
                  <button
                    onClick={() => setIsRegisterOpen(false)}
                    className="text-texter-text-muted hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {registerError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{registerError}</span>
                  </div>
                )}

                <form onSubmit={handleRegisterAgent} className="space-y-3">
                  <Input
                    label="Nombre del Agente"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="ej: Mac Studio Local o VPS Oracle"
                    required
                  />

                  <Input
                    label="Capacidad Máxima de VUs"
                    type="number"
                    min={10}
                    max={100000}
                    value={agentMaxVus.toString()}
                    onChange={(e) => setAgentMaxVus(Number(e.target.value))}
                    hint="Límite superior de concurrencia que este agente puede inyectar"
                  />

                  <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                    <Button variant="ghost" size="sm" type="button" onClick={() => setIsRegisterOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" size="sm" type="submit" isLoading={isRegistering}>
                      Generar Credencial
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-texter-warning font-bold text-base">
                  <AlertTriangle className="w-5 h-5" />
                  Guarda la API Key del Agente
                </div>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 leading-relaxed">
                  <strong>Atención:</strong> Esta clave secreta solo se muestra <strong>una única vez</strong>. Si la pierdes, deberás registrar un nuevo agente.
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-texter-text-dim">Token X-Fleet-Key:</label>
                  <div className="flex items-center gap-2 bg-texter-surface-subtle p-2.5 rounded-xl border border-texter-border font-mono text-xs text-white">
                    <span className="truncate flex-1 select-all">{registeredApiKey}</span>
                    <button
                      onClick={() => copyToClipboard(registeredApiKey)}
                      className="text-texter-cyan hover:text-white shrink-0 p-1"
                      title="Copiar clave"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-texter-success" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsRegisterOpen(false);
                      setRegisteredApiKey(null);
                    }}
                  >
                    He guardado la clave
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR CANCELACIÓN */}
      {cancelModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Ban className="w-5 h-5" />
              Confirmar Cancelación
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas cancelar la ejecución de{" "}
              <strong className="text-white">"{cancelModalJob.name}"</strong>? El agente detendrá el tráfico y marcará el trabajo como cancelado.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setCancelModalJob(null)}>
                Volver
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmCancel}
                isLoading={isCancelling}
              >
                Confirmar Cancelación
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}
