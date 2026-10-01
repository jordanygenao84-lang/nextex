"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { Automation } from "@/lib/jobs/types";
import {
  Calendar,
  Plus,
  Play,
  Pause,
  Archive,
  Clock,
  Globe,
  Layers,
} from "lucide-react";

export default function AutomationsPage() {
  const { workspace } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (workspace?.id) {
      loadAutomations();
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

  const handleStatusChange = async (autoId: string, action: "activate" | "pause" | "archive") => {
    try {
      const res = await fetch(`/api/automations/${autoId}/${action}`, { method: "POST" });
      if (res.ok) {
        loadAutomations();
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
        </div>

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
                <div className="flex items-center gap-1">
                  {auto.status === "active" ? (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(auto.id, "pause")} title="Pausar">
                      <Pause className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(auto.id, "activate")} title="Activar">
                      <Play className="w-3.5 h-3.5 text-texter-success" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleStatusChange(auto.id, "archive")} title="Archivar">
                    <Archive className="w-3.5 h-3.5 text-texter-text-dim" />
                  </Button>
                </div>
                <span className="text-[11px] text-texter-text-dim flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {auto.next_scheduled_at ? new Date(auto.next_scheduled_at).toLocaleTimeString() : "Pendiente"}
                </span>
              </div>
            </Card>
          ))}
          {automations.length === 0 && !isLoading && (
            <div className="col-span-full py-12 text-center text-texter-text-dim">
              No hay automations configuradas en este workspace.
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
