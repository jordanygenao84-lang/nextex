"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { Agent, AgentRun, AgentRunStep, ApprovalRequest } from "@/lib/agents/types";
import { CANONICAL_MODELS } from "@/lib/omniengine/registry/models";
import {
  Bot,
  Plus,
  Play,
  Pause,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Cpu,
  ChevronRight,
  Terminal,
  X,
  Check,
  Ban,
  Loader2,
  Clock,
  ShieldAlert,
} from "lucide-react";

export default function AgentsPage() {
  const { workspace } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  // Estados para modal de creación
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [modelId, setModelId] = useState("nextex-simulation");
  const [maxSteps, setMaxSteps] = useState(10);
  const [maxTokens, setMaxTokens] = useState(8000);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados para ejecución de un run
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [runInput, setRunInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null);
  const [currentSteps, setCurrentSteps] = useState<AgentRunStep[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  // Gobernanza HITL (Fase 4.4): Bandeja de aprobaciones
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [activeTab, setActiveTab] = useState<"agents" | "approvals">("agents");

  // Cargar agentes y aprobaciones
  useEffect(() => {
    async function loadData() {
      if (!workspace?.id) return;
      try {
        const [agentsRes, apprRes] = await Promise.all([
          fetch(`/api/agents?workspaceId=${workspace.id}`),
          fetch(`/api/approvals?workspaceId=${workspace.id}&status=pending`),
        ]);

        if (agentsRes.ok) {
          const json = await agentsRes.json();
          setAgents(json.agents || []);
        }

        if (apprRes.ok) {
          const json = await apprRes.json();
          setApprovals(json.approvals || []);
        }
      } catch {
        // Fallback
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [workspace?.id]);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemInstructions.trim() || !workspace?.id) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          name: name.trim(),
          description: description.trim() || null,
          system_instructions: systemInstructions.trim(),
          model_id: modelId,
          status: "active",
          max_steps: maxSteps,
          max_tokens: maxTokens,
          timeout_seconds: timeoutSeconds,
          tool_ids: ["calculator", "database_read", "database_write"],
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setAgents((prev) => [json.agent, ...prev]);
        setIsCreateOpen(false);
        setName("");
        setDescription("");
        setSystemInstructions("");
      }
    } catch (err) {
      console.error("Error al crear agente:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (agent: Agent) => {
    const nextStatus = agent.status === "active" ? "paused" : "active";
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, status: nextStatus } : a))
      );
    } catch (err) {
      console.error("Error al cambiar estado:", err);
    }
  };

  const handleExecuteRun = async () => {
    if (!activeAgent || !runInput.trim()) return;
    setIsRunning(true);
    setRunError(null);
    setCurrentSteps([]);

    try {
      const res = await fetch(`/api/agents/${activeAgent.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: runInput.trim() }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Fallo en la ejecución del agente.");
      }

      setCurrentRun(json.data.run);
      setCurrentSteps(json.data.steps || []);

      // Si el run quedó en waiting_approval, refrescar bandeja
      if (json.data.needsApproval && workspace?.id) {
        const apprRes = await fetch(`/api/approvals?workspaceId=${workspace.id}&status=pending`);
        if (apprRes.ok) {
          const apprJson = await apprRes.json();
          setApprovals(apprJson.approvals || []);
        }
      }
    } catch (err: any) {
      setRunError(err?.message || "Ocurrió un error inesperado.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleResolveApproval = async (approvalId: string, action: "approve" | "reject") => {
    setIsApproving(true);
    try {
      const res = await fetch(`/api/approvals/${approvalId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: `Resuelto vía Dashboard como ${action}` }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Error al procesar la aprobación.");
      }

      // Remover de la lista activa
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId));

      if (currentRun && json.data?.run) {
        setCurrentRun(json.data.run);
        setCurrentSteps(json.data.steps || []);
      }
    } catch (err: any) {
      setRunError(err?.message || "Error al resolver la aprobación.");
    } finally {
      setIsApproving(false);
    }
  };

  const filteredAgents = agents.filter((a) => {
    if (statusFilter === "all") return a.status !== "archived";
    return a.status === statusFilter;
  });

  return (
    <DashboardShell
      title="Orquestador de Agentes Autónomos"
      subtitle="Definición declarativa, gobernanza de permisos y telemetría de ejecución"
    >
      <div className="space-y-6">
        {/* Banner Superior & Acciones Rápidas */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-texter-surface to-texter-surface-elevated border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white tracking-tight">
                NEXTEХ Agent Core v4.4
              </span>
              <Badge variant="cyan" size="sm">
                Permissions & Governance
              </Badge>
              {approvals.length > 0 && (
                <Badge variant="warning" size="sm" dot>
                  {approvals.length} Aprobación(es) Pendiente(s)
                </Badge>
              )}
            </div>
            <p className="text-xs text-texter-text-muted flex items-center gap-2 flex-wrap">
              <span>Gobernanza con Human-in-the-Loop desacoplada</span>
              <span className="text-texter-border">•</span>
              <span className="text-emerald-400 flex items-center gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                JIT Revalidation & Fencing Activos
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={activeTab === "approvals" ? "primary" : "outline"}
              size="md"
              leftIcon={<Clock className="w-4 h-4" />}
              onClick={() => setActiveTab(activeTab === "approvals" ? "agents" : "approvals")}
            >
              Bandeja HITL ({approvals.length})
            </Button>
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => setIsCreateOpen(true)}
            >
              Nuevo Agente
            </Button>
          </div>
        </div>

        {/* VISTA 1: BANDEJA DE APROBACIONES HITL (Fase 4.4) */}
        {activeTab === "approvals" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-texter-amber" />
                <h3 className="text-sm font-bold text-white">
                  Solicitudes de Aprobación Humana Pendientes (HITL)
                </h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setActiveTab("agents")}>
                Volver a Agentes
              </Button>
            </div>

            {approvals.length === 0 ? (
              <Card variant="elevated" padding="lg" className="text-center py-12">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="text-sm font-semibold text-white">No hay solicitudes pendientes</p>
                <p className="text-xs text-texter-text-muted mt-1">
                  Todas las ejecuciones protegidas han sido resueltas o no requieren intervención humana.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {approvals.map((req) => (
                  <Card key={req.id} variant="elevated" padding="md" className="border-amber-500/30 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white font-mono">
                            Herramienta: {req.tool_id}@{req.tool_version}
                          </span>
                          <Badge variant="warning" size="sm">
                            {req.risk_level.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-xs text-texter-text-muted mt-1 font-mono">
                          ID Solicitud: {req.id} • Expira: {new Date(req.expires_at).toLocaleTimeString()}
                        </p>
                        <p className="text-[11px] text-texter-cyan font-mono mt-0.5">
                          Hash de Integridad (RFC 8785): {req.payload_hash.substring(0, 16)}...
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isApproving}
                          onClick={() => handleResolveApproval(req.id, "reject")}
                          leftIcon={<Ban className="w-3.5 h-3.5 text-rose-400" />}
                        >
                          Rechazar
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isApproving}
                          isLoading={isApproving}
                          onClick={() => handleResolveApproval(req.id, "approve")}
                          leftIcon={<Check className="w-3.5 h-3.5" />}
                        >
                          Aprobar y Ejecutar
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* VISTA 2: GRID DE AGENTES */
          <div className="space-y-4">
            {/* Barra de Filtros */}
            <div className="flex items-center justify-between gap-4 flex-wrap border-b border-texter-border/50 pb-3">
              <div className="flex items-center gap-2">
                {[
                  { id: "all", label: "Activos & Borradores" },
                  { id: "active", label: "Solo Activos" },
                  { id: "draft", label: "Borradores" },
                  { id: "paused", label: "Pausados" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                      statusFilter === f.id
                        ? "bg-texter-indigo text-white shadow-sm"
                        : "bg-texter-surface-subtle text-texter-text-muted hover:text-white border border-texter-border"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <span className="text-xs font-mono text-texter-text-dim">
                Total: {filteredAgents.length} agente(s)
              </span>
            </div>

            {/* Grid de Agentes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAgents.map((agent) => {
                const isActive = agent.status === "active";
                const isPaused = agent.status === "paused";

                return (
                  <Card
                    key={agent.id}
                    variant="elevated"
                    padding="md"
                    className="border-texter-border/80 flex flex-col justify-between hover:border-texter-indigo/40 transition-all shadow-md group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-center text-texter-cyan">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-white group-hover:text-texter-cyan transition-colors">
                              {agent.name}
                            </h3>
                            <span className="text-[10px] font-mono text-texter-text-dim flex items-center gap-1">
                              <Cpu className="w-3 h-3 text-texter-indigo" />
                              {agent.model_id}
                            </span>
                          </div>
                        </div>

                        <Badge
                          variant={isActive ? "success" : isPaused ? "warning" : "default"}
                          size="sm"
                          dot
                        >
                          {agent.status.toUpperCase()}
                        </Badge>
                      </div>

                      <p className="text-xs text-texter-text-muted line-clamp-2 leading-relaxed">
                        {agent.description || "Sin descripción proporcionada."}
                      </p>

                      {/* Metadatos, Límites y Política de Gobernanza */}
                      <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border/50 text-[10px] font-mono text-texter-text-dim">
                        <div>
                          <span>Pasos máx:</span>
                          <p className="text-white font-semibold">{agent.max_steps}</p>
                        </div>
                        <div>
                          <span>Tokens:</span>
                          <p className="text-white font-semibold">
                            {(agent.max_tokens / 1000).toFixed(0)}k
                          </p>
                        </div>
                        <div>
                          <span>Timeout:</span>
                          <p className="text-white font-semibold">{agent.timeout_seconds}s</p>
                        </div>
                      </div>

                      {/* Badges de Gobernanza de Riesgos */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-texter-text-dim">
                        <span className="px-1.5 py-0.5 rounded bg-texter-surface border border-texter-border">
                          Riesgos: READ, WRITE
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-texter-surface border border-texter-border text-amber-300">
                          HITL Requerido
                        </span>
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="pt-4 border-t border-texter-border/60 flex items-center justify-between gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(agent)}
                        className="text-xs text-texter-text-muted hover:text-white flex items-center gap-1 font-mono transition-colors"
                      >
                        {isActive ? (
                          <>
                            <Pause className="w-3.5 h-3.5 text-amber-400" />
                            <span>Pausar</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Activar</span>
                          </>
                        )}
                      </button>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isActive}
                        onClick={() => {
                          setActiveAgent(agent);
                          setCurrentRun(null);
                          setCurrentSteps([]);
                          setRunError(null);
                          setRunInput("");
                        }}
                        rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                      >
                        Ejecutar Run
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* MODAL CREAR AGENTE */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-texter-indigo" />
                <h2 className="text-base font-bold text-white">
                  Crear Nuevo Agente
                </h2>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-4">
              <Input
                label="Nombre del Agente"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Agente de Verificación Contable"
                required
              />

              <Input
                label="Descripción funcional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve propósito del agente"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Instrucciones del Sistema (System Prompt)
                </label>
                <textarea
                  value={systemInstructions}
                  onChange={(e) => setSystemInstructions(e.target.value)}
                  placeholder="Define el comportamiento, rol, restricciones y criterios de éxito del agente..."
                  rows={4}
                  required
                  className="w-full p-3 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">
                    Modelo de Inferencia
                  </label>
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    {CANONICAL_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.provider})
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  label="Límite de Pasos Operativos"
                  type="number"
                  value={maxSteps.toString()}
                  onChange={(e) => setMaxSteps(Number(e.target.value))}
                  min={1}
                  max={50}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Tokens Máximos por Run"
                  type="number"
                  value={maxTokens.toString()}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  min={1000}
                  max={128000}
                />

                <Input
                  label="Timeout (segundos)"
                  type="number"
                  value={timeoutSeconds.toString()}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  min={5}
                  max={300}
                />
              </div>

              <div className="pt-3 border-t border-texter-border flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="md"
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  isLoading={isSubmitting}
                >
                  Guardar Agente
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL DE EJECUCIÓN DEL AGENTE */}
      {activeAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-texter-cyan" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Ejecutar Run: {activeAgent.name}
                  </h2>
                  <p className="text-xs text-texter-text-muted font-mono">
                    Modelo: {activeAgent.model_id} • Pasos máx: {activeAgent.max_steps}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveAgent(null)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-texter-text-secondary">
                Instrucción o Tarea de Entrada (Input)
              </label>
              <textarea
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
                placeholder="ej: calcula (250 * 12) + 400 ó revisa los últimos registros..."
                rows={3}
                disabled={isRunning}
                className="w-full p-3 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none"
              />
            </div>

            <div className="flex justify-end">
              <Button
                variant="primary"
                size="md"
                onClick={handleExecuteRun}
                disabled={!runInput.trim() || isRunning}
                isLoading={isRunning}
                leftIcon={<Play className="w-4 h-4" />}
              >
                {isRunning ? "Orquestando Run..." : "Iniciar Ejecución"}
              </Button>
            </div>

            {/* Error si ocurre */}
            {runError && (
              <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{runError}</span>
              </div>
            )}

            {/* Trazabilidad de Pasos Operativos */}
            {currentSteps.length > 0 && (
              <div className="space-y-3 pt-3 border-t border-texter-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-texter-text-muted font-mono">
                    Pasos de Ejecución Auditados ({currentSteps.length})
                  </h4>
                  {currentRun?.status === "waiting_approval" && (
                    <Badge variant="warning" size="sm" dot>
                      ESPERANDO APROBACIÓN HUMANA
                    </Badge>
                  )}
                </div>

                <div className="space-y-2">
                  {currentSteps.map((s) => {
                    const isApprovalPending = s.step_type === "APPROVAL_REQUEST" && s.status === "pending";

                    return (
                      <div
                        key={s.id}
                        className={`p-3.5 rounded-xl border text-xs space-y-2 font-mono ${
                          isApprovalPending
                            ? "bg-amber-950/20 border-amber-500/50"
                            : "bg-texter-surface-subtle border-texter-border"
                        }`}
                      >
                        <div className="flex items-center justify-between text-texter-cyan">
                          <span className="font-semibold">
                            Paso {s.step_number}: [{s.step_type}]
                          </span>
                          <Badge
                            variant={
                              s.status === "completed"
                                ? "success"
                                : s.status === "pending"
                                ? "warning"
                                : "default"
                            }
                            size="sm"
                          >
                            {s.status.toUpperCase()}
                          </Badge>
                        </div>

                        {/* Detalle si es solicitud de aprobación */}
                        {isApprovalPending && (
                          <div className="space-y-2 pt-2 border-t border-amber-500/30 text-amber-200">
                            <p className="text-[11px] leading-relaxed">
                              ⚠️ El agente solicita ejecutar la herramienta{" "}
                              <strong className="text-white underline">{s.tool_id}</strong> con nivel de riesgo mutativo.
                            </p>
                            <pre className="p-2 rounded bg-black/40 text-[10px] text-amber-300 overflow-x-auto">
                              {JSON.stringify(s.input, null, 2)}
                            </pre>
                          </div>
                        )}

                        <p className="text-texter-text-secondary text-[11px]">
                          Inicio: {new Date(s.started_at).toLocaleTimeString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resultado Final */}
            {currentRun?.output && (
              <div className="p-4 rounded-xl bg-texter-indigo/10 border border-indigo-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-indigo-300 font-mono">
                  <span className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Respuesta Final del Agente
                  </span>
                  <span>Tokens: {currentRun.total_tokens}</span>
                </div>
                <p className="text-xs text-white leading-relaxed whitespace-pre-wrap">
                  {currentRun.output}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
