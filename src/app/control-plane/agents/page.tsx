"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import {
  Bot,
  RefreshCw,
  AlertTriangle,
  Layers,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface AgentItem {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  model_id: string;
  status: string;
  max_steps: number;
  max_tokens: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export default function AgentsControlPage() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/agents");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar agentes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  return (
    <DashboardShell
      title="Agentes Autónomos (Control Plane)"
      subtitle="Supervisión de directivas de gobernanza, cuotas de tokens, límites de pasos y políticas de ejecución"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-texter-indigo" />
            <h2 className="text-white font-semibold text-lg">Catálogo de Agentes Activos</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-texter-text-muted">
              {agents.length} agentes
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAgents}
            disabled={isLoading}
            className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {agents.length === 0 ? (
            <div className="col-span-full bg-texter-surface border border-texter-border rounded-2xl p-8 text-center text-xs font-mono text-texter-text-muted">
              {isLoading ? "Consultando agentes..." : "No se encontraron agentes configurados."}
            </div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all font-mono text-xs"
              >
                <div className="flex items-start justify-between gap-2 border-b border-texter-border/50 pb-3">
                  <div>
                    <h3 className="text-white font-bold text-sm truncate max-w-[180px]">{agent.name}</h3>
                    <p className="text-[10px] text-texter-text-muted truncate max-w-[180px] mt-0.5">
                      {agent.description || "Sin descripción"}
                    </p>
                  </div>
                  <DecisionBadge decision={agent.status} />
                </div>

                <div className="space-y-2 text-[11px] text-texter-text-secondary">
                  <div className="flex justify-between">
                    <span className="text-texter-text-muted">Modelo:</span>
                    <span className="text-texter-cyan font-semibold">{agent.model_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-texter-text-muted">Max Steps:</span>
                    <span className="text-white font-medium">{agent.max_steps} pasos</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-texter-text-muted">Max Tokens:</span>
                    <span className="text-white font-medium">{agent.max_tokens}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-texter-text-muted">Timeout:</span>
                    <span className="text-white font-medium">{agent.timeout_seconds}s</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-texter-border/50 flex justify-between items-center text-[10px]">
                  <span className="text-texter-text-dim">ID: {agent.id.slice(0, 8)}</span>
                  <Link
                    href={`/agents/${agent.id}/settings`}
                    className="text-texter-indigo hover:text-indigo-300 font-semibold inline-flex items-center gap-1"
                  >
                    <Settings className="w-3 h-3" />
                    Directiva
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
