"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import {
  FileText,
  RefreshCw,
  AlertTriangle,
  Search,
  Filter,
  Shield,
  Hash,
  Eye,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface AuditLogEvent {
  event_id: string;
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: string;
  reason?: string;
  correlation_id?: string;
  trace_id?: string;
  fencing_token?: number;
  metadata?: Record<string, any>;
  created_at: string;
}

export default function AuditControlPage() {
  const [events, setEvents] = useState<AuditLogEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [actionFilter, setActionFilter] = useState("");
  const [correlationFilter, setCorrelationFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");

  // Drawer / modal para ver detalle de evento
  const [selectedEvent, setSelectedEvent] = useState<AuditLogEvent | null>(null);

  const fetchAuditEvents = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (actionFilter) params.append("action", actionFilter);
      if (correlationFilter) params.append("correlationId", correlationFilter);
      if (decisionFilter) params.append("decision", decisionFilter);

      const res = await fetch(`/api/control-plane/audit?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar eventos de auditoría");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditEvents();
  }, [decisionFilter]);

  return (
    <DashboardShell
      title="Auditoría Inmutable (Append-Only)"
      subtitle="Registro forense append-only (Trigger 55000) con sanitización activa de credenciales y correlación de contexto"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-texter-cyan" />
            <h2 className="text-white font-semibold text-lg">Pistas de Auditoría</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-emerald-400">
              Inmutable (Trigger 55000)
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAuditEvents}
            disabled={isLoading}
            className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </div>

        {/* Barra de Filtros */}
        <div className="bg-texter-surface border border-texter-border rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-texter-text-muted" />
            <input
              type="text"
              placeholder="Buscar por correlation_id..."
              value={correlationFilter}
              onChange={(e) => setCorrelationFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchAuditEvents()}
              className="bg-transparent text-white w-full focus:outline-none placeholder:text-texter-text-dim"
            />
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Filter className="w-3.5 h-3.5 text-texter-text-muted" />
            <input
              type="text"
              placeholder="Filtrar por acción..."
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchAuditEvents()}
              className="bg-transparent text-white w-full focus:outline-none placeholder:text-texter-text-dim"
            />
          </div>

          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            className="bg-texter-surface-subtle border border-texter-border rounded-lg px-2.5 py-1 text-white focus:outline-none"
          >
            <option value="">Todas las Decisiones</option>
            <option value="allow">ALLOW</option>
            <option value="deny">DENY</option>
            <option value="requires_approval">REQUIRES_APPROVAL</option>
            <option value="blocked">BLOCKED</option>
            <option value="expired">EXPIRED</option>
          </select>

          <Button variant="ghost" size="sm" onClick={fetchAuditEvents} className="border border-texter-border">
            Filtrar
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tabla de Eventos de Auditoría */}
        <div className="bg-texter-surface border border-texter-border rounded-2xl overflow-hidden shadow-sm font-mono text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-texter-border bg-texter-surface-subtle/40 text-texter-text-muted">
                  <th className="py-3 px-4 font-semibold">EVENT ID</th>
                  <th className="py-3 px-4 font-semibold">ACCIÓN</th>
                  <th className="py-3 px-4 font-semibold">RECURSO</th>
                  <th className="py-3 px-4 font-semibold">DECISIÓN</th>
                  <th className="py-3 px-4 font-semibold">ACTOR</th>
                  <th className="py-3 px-4 font-semibold">CORRELACIÓN</th>
                  <th className="py-3 px-4 font-semibold">TIMESTAMP</th>
                  <th className="py-3 px-4 font-semibold text-right">DETALLE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50 text-texter-text-secondary">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-texter-text-muted">
                      {isLoading ? "Consultando eventos..." : "No se encontraron eventos de auditoría."}
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.event_id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="py-3 px-4 text-texter-cyan">
                        #{e.event_id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {e.action}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-texter-text-muted">{e.resource_type}:</span> {e.resource_id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <DecisionBadge decision={e.decision} />
                      </td>
                      <td className="py-3 px-4 text-texter-text-muted">
                        {e.actor_type} ({e.actor_id.slice(0, 8)})
                      </td>
                      <td className="py-3 px-4 text-texter-indigo">
                        {e.correlation_id ? e.correlation_id.slice(0, 10) : "—"}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-texter-text-muted">
                        {new Date(e.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEvent(e)}
                          className="text-texter-cyan hover:text-cyan-300 p-1 h-auto"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal de Detalle de Auditoría Sanitizado */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-texter-surface border border-texter-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white text-sm">Evento de Auditoría #{selectedEvent.event_id.slice(0, 8)}</h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-texter-text-muted hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 font-mono text-xs max-h-[70vh] overflow-y-auto">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Acción:</span>
                  <span className="text-white font-bold">{selectedEvent.action}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Decisión:</span>
                  <DecisionBadge decision={selectedEvent.decision} />
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Actor:</span>
                  <span className="text-white">{selectedEvent.actor_type} ({selectedEvent.actor_id})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Recurso:</span>
                  <span className="text-white">{selectedEvent.resource_type}: {selectedEvent.resource_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Correlation ID:</span>
                  <span className="text-texter-indigo">{selectedEvent.correlation_id || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Trace ID:</span>
                  <span className="text-texter-cyan">{selectedEvent.trace_id || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-texter-text-muted">Timestamp:</span>
                  <span className="text-white">{new Date(selectedEvent.created_at).toISOString()}</span>
                </div>
              </div>

              <div>
                <span className="text-texter-text-muted block mb-1.5 font-semibold">Metadatos Sanitizados:</span>
                <pre className="p-3 rounded-xl bg-black/60 border border-texter-border text-[11px] text-emerald-400 overflow-x-auto">
                  {JSON.stringify(selectedEvent.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-texter-border bg-texter-surface-subtle/30 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
