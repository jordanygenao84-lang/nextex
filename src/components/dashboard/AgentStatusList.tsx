"use client";

import React, { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Bot } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface Agent {
  id: string;
  name: string;
  description?: string | null;
  status: string;
}

// Lista real de agentes del workspace (antes eran 4 agentes de muestra
// fijos, con el encabezado contando 3 activos y la lista mostrando 4).
export const AgentStatusList: React.FC = () => {
  const { workspace } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    fetch(`/api/agents?workspaceId=${workspace.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setAgents(Array.isArray(d?.agents) ? d.agents : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const activeCount = agents.filter((a) => a.status === "active").length;

  return (
    <Card variant="elevated" padding="none">
      <div className="p-4 border-b border-texter-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Bot className="w-4 h-4 text-texter-indigo" />
          Agentes Autónomos
        </h3>
        <Badge variant="indigo" size="sm">
          {loading ? "…" : `${activeCount} en ejecución`}
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        {loading ? (
          <p className="text-xs text-texter-text-muted text-center py-4">
            Cargando agentes…
          </p>
        ) : agents.length === 0 ? (
          <p className="text-xs text-texter-text-muted text-center py-4">
            No hay agentes autónomos configurados en este workspace.
          </p>
        ) : (
          agents.map((agent) => {
            const isActive = agent.status === "active";
            const initials = agent.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <div
                key={agent.id}
                className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border hover:border-texter-border-hover transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-texter-surface border border-texter-border flex items-center justify-center font-mono font-bold text-xs text-texter-cyan shrink-0 shadow-sm">
                    {initials || "AG"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-semibold text-white truncate">
                        {agent.name}
                      </h4>
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isActive
                            ? "bg-texter-emerald animate-pulse"
                            : "bg-texter-amber"
                        }`}
                      />
                    </div>
                    <p className="text-[11px] text-texter-text-muted truncate">
                      {agent.description || "Sin descripción"}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-semibold text-white">
                    {isActive ? "Activo" : "Pausado"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
};
