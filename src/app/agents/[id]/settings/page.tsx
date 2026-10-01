"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Agent, AgentMemory, AgentPolicy } from "@/lib/agents/types";
import {
  Brain,
  ShieldAlert,
  ArrowLeft,
  Check,
  Trash2,
  Archive,
  RefreshCw,
  Search,
  Sparkles,
  Sliders,
  Database,
  History,
  Info,
} from "lucide-react";

export default function AgentSettingsPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [activeTab, setActiveTab] = useState<"memory" | "general">("memory");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Estados de Política de Memoria (Fase 4.5)
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [retrievalMode, setRetrievalMode] = useState<string>("semantic");
  const [maxTokens, setMaxTokens] = useState<number>(1000);
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.7);
  const [writeMode, setWriteMode] = useState<string>("quarantined");

  // Búsqueda y prueba semántica en vivo
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    fetchAgentAndPolicy();
    fetchMemories();
  }, [agentId, statusFilter]);

  async function fetchAgentAndPolicy() {
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      if (res.ok) {
        const data = await res.json();
        setAgent(data.agent);
        if (data.policy) {
          setPolicy(data.policy);
          setMemoryEnabled(data.policy.memory_enabled !== false);
          setRetrievalMode(data.policy.memory_retrieval_mode || "semantic");
          setMaxTokens(data.policy.memory_max_tokens || 1000);
          setSimilarityThreshold(data.policy.memory_similarity_threshold ?? 0.7);
          setWriteMode(data.policy.memory_write_mode || "quarantined");
        }
      }
    } catch {
      // Ignorar en fallback local
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMemories() {
    try {
      const res = await fetch(`/api/agents/${agentId}/memories?status=${statusFilter}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch {
      // Fallback
    }
  }

  async function handleSavePolicy() {
    setIsSaving(true);
    setNotification(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memory_enabled: memoryEnabled,
          memory_retrieval_mode: retrievalMode,
          memory_max_tokens: maxTokens,
          memory_similarity_threshold: similarityThreshold,
          memory_write_mode: writeMode,
        }),
      });
      if (res.ok) {
        setNotification("Política de memoria actualizada exitosamente.");
      }
    } catch (err: any) {
      setNotification(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApproveQuarantine(memoryId: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/memories/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch {
      // Fallback
    }
  }

  async function handleArchiveMemory(memoryId: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/memories/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch {
      // Fallback
    }
  }

  async function handleDeleteMemory(memoryId: string) {
    if (!confirm("¿Deseas purgar permanentemente esta memoria? La auditoría será preservada.")) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/memories/${memoryId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch {
      // Fallback
    }
  }

  async function handleTestSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/memories/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), limit: 5 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.matches || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Cabecera y Navegación */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/agents">
              <Button variant="ghost" size="sm" className="gap-2 text-zinc-400 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Volver a Agentes
              </Button>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Brain className="h-5 w-5 text-indigo-400" />
              Configuración de Agente: {agent?.name || agentId}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant={activeTab === "memory" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("memory")}
              className="gap-2"
            >
              <Brain className="h-4 w-4" /> Memoria Cognitiva
            </Button>
            <Button
              variant={activeTab === "general" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("general")}
              className="gap-2"
            >
              <Sliders className="h-4 w-4" /> Parámetros
            </Button>
          </div>
        </div>

        {notification && (
          <div className="p-3 bg-indigo-900/30 border border-indigo-700/50 rounded-lg text-indigo-300 text-sm flex items-center justify-between">
            <span>{notification}</span>
            <button onClick={() => setNotification(null)} className="text-xs hover:underline">Cerrar</button>
          </div>
        )}

        {/* Panel de Memoria Cognitiva (Fase 4.5) */}
        {activeTab === "memory" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna Izquierda: Gobernanza de Políticas de Memoria */}
            <div className="lg:col-span-1 space-y-6">
              <Card className="p-5 border-white/10 bg-zinc-900/70 space-y-4">
                <h3 className="font-semibold text-white flex items-center gap-2 border-b border-white/10 pb-2">
                  <Sliders className="h-4 w-4 text-indigo-400" /> Gobernanza de Memoria
                </h3>

                {/* Switch Habilitar Memoria */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">Memoria Habilitada</label>
                  <input
                    type="checkbox"
                    checked={memoryEnabled}
                    onChange={(e) => setMemoryEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                {/* Modo de Retrieval */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1">Modo de Recuperación</label>
                  <select
                    value={retrievalMode}
                    onChange={(e) => setRetrievalMode(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md text-sm text-white px-3 py-1.5 focus:border-indigo-500"
                  >
                    <option value="disabled">Disabled (Deshabilitada)</option>
                    <option value="recent">Recent (Cronológica reciente)</option>
                    <option value="semantic">Semantic (pgvector 1536d)</option>
                    <option value="hybrid">Hybrid (Híbrida Semántica + Reciente)</option>
                  </select>
                </div>

                {/* Modo de Escritura */}
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1">Modo de Escritura / Ingestión</label>
                  <select
                    value={writeMode}
                    onChange={(e) => setWriteMode(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md text-sm text-white px-3 py-1.5 focus:border-indigo-500"
                  >
                    <option value="quarantined">Quarantined (Requiere Aprobación memory.manage)</option>
                    <option value="automatic">Automatic (Activa de Inmediato)</option>
                    <option value="disabled">Disabled (Cero persistencia post-run)</option>
                  </select>
                </div>

                {/* Presupuesto de Tokens */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Presupuesto de Tokens (Prompt)</span>
                    <span className="text-white font-mono">{maxTokens} tokens</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="4000"
                    step="50"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>

                {/* Umbral de Similitud */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Umbral Mínimo de Similitud</span>
                    <span className="text-white font-mono">{similarityThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.50"
                    max="0.95"
                    step="0.05"
                    value={similarityThreshold}
                    onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <Button
                  variant="primary"
                  className="w-full"
                  size="sm"
                  onClick={handleSavePolicy}
                  disabled={isSaving}
                >
                  {isSaving ? "Guardando..." : "Guardar Políticas de Memoria"}
                </Button>

                {/* Banner de Seguridad: Memory != Authority */}
                <div className="p-3 bg-zinc-950 border border-amber-500/30 rounded-lg text-xs text-amber-300/90 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5 text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> REGLA INVIOLABLE: MEMORY != AUTHORITY
                  </div>
                  <p>
                    Los recuerdos son datos históricos no confiables. Jamás otorgan permisos,
                    no saltan aprobaciones humanas (HITL) ni modifican instrucciones de sistema.
                  </p>
                </div>
              </Card>

              {/* Prueba de Búsqueda Semántica en Vivo */}
              <Card className="p-5 border-white/10 bg-zinc-900/70 space-y-3">
                <h3 className="font-semibold text-white flex items-center gap-2 text-sm border-b border-white/10 pb-2">
                  <Search className="h-4 w-4 text-indigo-400" /> Búsqueda de Memoria en Vivo
                </h3>
                <form onSubmit={handleTestSearch} className="flex gap-2">
                  <Input
                    placeholder="Consultar recuerdos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="text-xs bg-zinc-800"
                  />
                  <Button size="sm" type="submit" disabled={isSearching}>
                    {isSearching ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Buscar"}
                  </Button>
                </form>

                {searchResults && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pt-2">
                    {searchResults.length === 0 ? (
                      <p className="text-xs text-zinc-500">No se encontraron recuerdos que superen el umbral.</p>
                    ) : (
                      searchResults.map((r, i) => (
                        <div key={i} className="p-2 bg-zinc-950 rounded border border-white/5 text-xs space-y-1">
                          <div className="flex justify-between text-zinc-400">
                            <span>Similitud: {(r.similarity * 100).toFixed(1)}%</span>
                            <Badge variant="outline" className="text-[10px]">{r.scope}</Badge>
                          </div>
                          <p className="text-zinc-300 font-mono text-[11px] line-clamp-2">{r.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* Columna Derecha: Explorador y Gestor de Recuerdos */}
            <div className="lg:col-span-2 space-y-4">
              <Card className="p-5 border-white/10 bg-zinc-900/70 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <Database className="h-4 w-4 text-indigo-400" /> Explorador de Recuerdos Persistidos
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Recuerdos cognitivos filtrados por estado y ámbito de aplicación.
                    </p>
                  </div>
                  <div className="flex gap-1.5 bg-zinc-800 p-1 rounded-lg">
                    {["active", "quarantined", "archived", "deprecated"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`text-xs px-2.5 py-1 rounded capitalize transition-colors ${
                          statusFilter === st ? "bg-indigo-600 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {memories.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-zinc-800 rounded-lg space-y-2">
                    <History className="h-8 w-8 text-zinc-600 mx-auto" />
                    <p className="text-sm text-zinc-400 font-medium">No hay recuerdos en estado &apos;{statusFilter}&apos;</p>
                    <p className="text-xs text-zinc-500">
                      Los recuerdos se ingestan al completar ejecuciones exitosas o mediante inserción manual.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {memories.map((m) => (
                      <div
                        key={m.id}
                        className="p-3.5 bg-zinc-950/80 rounded-lg border border-white/5 hover:border-indigo-500/30 transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant={m.status === "active" ? "success" : m.status === "quarantined" ? "warning" : "default"}>
                              {m.status}
                            </Badge>
                            <Badge variant="outline" className="text-zinc-400 text-xs">
                              {m.type}
                            </Badge>
                            <Badge variant="outline" className="text-indigo-400 text-xs">
                              {m.scope}
                            </Badge>
                            <span className="text-[11px] text-zinc-500">
                              Accesos: <span className="font-mono text-zinc-400">{m.access_count}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {m.status === "quarantined" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-950/30"
                                onClick={() => handleApproveQuarantine(m.id)}
                              >
                                <Check className="h-3 w-3" /> Aprobar Cuarentena
                              </Button>
                            )}
                            {m.status === "active" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-zinc-400 hover:text-zinc-200"
                                onClick={() => handleArchiveMemory(m.id)}
                              >
                                <Archive className="h-3 w-3" /> Archivar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-rose-400 hover:text-rose-200"
                              onClick={() => handleDeleteMemory(m.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-200 font-mono bg-zinc-900/50 p-2.5 rounded border border-white/5">
                          {m.content}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 pt-1 border-t border-white/5">
                          <span>Creado: {new Date(m.created_at).toLocaleString()}</span>
                          {m.source_run_id && (
                            <span>Run: <span className="font-mono text-zinc-400">{m.source_run_id.substring(0, 8)}...</span></span>
                          )}
                          {m.source_step_id && (
                            <span>Step: <span className="font-mono text-zinc-400">{m.source_step_id.substring(0, 8)}...</span></span>
                          )}
                          {m.expires_at && (
                            <span className="text-amber-500">Expira: {new Date(m.expires_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* Panel de Parámetros Generales */}
        {activeTab === "general" && (
          <Card className="p-6 border-white/10 bg-zinc-900/70 space-y-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Sliders className="h-4 w-4 text-indigo-400" /> Parámetros de Inferencia del Agente
            </h3>
            <p className="text-xs text-zinc-400">
              Instrucciones del sistema, modelo y cuotas base definidas en Fase 4.1.
            </p>
            <div className="space-y-3 max-w-xl text-sm text-zinc-300">
              <div>
                <span className="text-xs text-zinc-500 block">Modelo Asignado:</span>
                <span className="font-mono text-white">{agent?.model_id}</span>
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Instrucciones del Sistema:</span>
                <p className="font-mono text-xs bg-zinc-950 p-3 rounded border border-white/5 whitespace-pre-wrap">
                  {agent?.system_instructions || "Sin instrucciones específicas."}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
