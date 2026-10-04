"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import { ConfirmationModal } from "@/components/control-plane/ConfirmationModal";
import {
  Server,
  RefreshCw,
  AlertTriangle,
  Radio,
  Layers,
  ShieldAlert,
  PlayCircle,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface WorkerItem {
  id: string;
  workspace_id: string;
  worker_identity: string;
  instance_identity: string;
  status: string;
  version: string;
  capabilities: string[];
  max_concurrency: number;
  current_concurrency: number;
  last_heartbeat_at: string;
  registered_at: string;
  activeLeasesCount: number;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<WorkerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modal de confirmación para acción destructiva
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    workerId: string;
    workerIdentity: string;
    workspaceId: string;
    action: "drain" | "quarantine" | "release_quarantine";
    title: string;
    description: string;
    impact: string;
  }>({
    isOpen: false,
    workerId: "",
    workerIdentity: "",
    workspaceId: "",
    action: "drain",
    title: "",
    description: "",
    impact: "",
  });

  const [isExecutingAction, setIsExecutingAction] = useState(false);

  const fetchWorkers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/control-plane/workers");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setWorkers(data.workers || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar workers");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();
  }, []);

  const openActionModal = (
    worker: WorkerItem,
    action: "drain" | "quarantine" | "release_quarantine"
  ) => {
    let title = "";
    let description = "";
    let impact = "";

    if (action === "drain") {
      title = "Drenar Worker";
      description = `Solicitará el drenado cooperativo del worker '${worker.worker_identity}'. No se le asignarán nuevos claims y esperará a que finalicen sus leases activos.`;
      impact = "Transición a DRAINING. Despachos congelados para esta instancia.";
    } else if (action === "quarantine") {
      title = "Poner Worker en Cuarentena";
      description = `Aislará inmediatamente al worker '${worker.worker_identity}'. Revocará sus leases activos y marcará jobs para recuperación.`;
      impact = "Transición a QUARANTINED. Revocación de leases activos.";
    } else if (action === "release_quarantine") {
      title = "Liberar Worker de Cuarentena";
      description = `Liberará '${worker.worker_identity}' a STOPPED. El worker deberá completar un nuevo handshake antes de recibir trabajos.`;
      impact = "Transición transaccional a STOPPED; se requiere un nuevo registro del worker.";
    }

    setModalState({
      isOpen: true,
      workerId: worker.id,
      workerIdentity: worker.worker_identity,
      workspaceId: worker.workspace_id,
      action,
      title,
      description,
      impact,
    });
  };

  const handleConfirmAction = async () => {
    try {
      setIsExecutingAction(true);
      setError(null);
      setActionMessage(null);

      const res = await fetch("/api/control-plane/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: modalState.workerId,
          action: modalState.action,
          reason: modalState.description,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error?.message || `Error en la acción (${res.status})`);
      }

      setActionMessage(`Acción '${modalState.action}' completada con éxito conforme a la gobernanza.`);
      setModalState((prev) => ({ ...prev, isOpen: false }));
      await fetchWorkers();
    } catch (err: any) {
      setError(err.message || "Error al ejecutar la acción");
    } finally {
      setIsExecutingAction(false);
    }
  };

  return (
    <DashboardShell
      title="Workers del Control Plane"
      subtitle="Supervisión de instancias activas, leases, capacidad de concurrencia y acciones operacionales de drenado"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-texter-cyan" />
            <h2 className="text-white font-semibold text-lg">Cluster de Workers</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-texter-text-muted">
              {workers.length} registrados
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchWorkers}
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

        {actionMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2.5">
            <Radio className="w-4 h-4 shrink-0 animate-pulse" />
            <span>{actionMessage}</span>
          </div>
        )}

        {/* Tabla de Workers */}
        <div className="bg-texter-surface border border-texter-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-texter-border bg-texter-surface-subtle/40 text-texter-text-muted">
                  <th className="py-3 px-4 font-semibold">WORKER</th>
                  <th className="py-3 px-4 font-semibold">INSTANCIA</th>
                  <th className="py-3 px-4 font-semibold">ESTADO</th>
                  <th className="py-3 px-4 font-semibold">CONCURRENCIA</th>
                  <th className="py-3 px-4 font-semibold">LEASES ACTIVOS</th>
                  <th className="py-3 px-4 font-semibold">CAPABILITIES</th>
                  <th className="py-3 px-4 font-semibold">ÚLTIMO LATIDO</th>
                  <th className="py-3 px-4 font-semibold text-right">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50 text-texter-text-secondary">
                {workers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-texter-text-muted">
                      {isLoading ? "Consultando workers..." : "No hay workers registrados en este workspace."}
                    </td>
                  </tr>
                ) : (
                  workers.map((w) => (
                    <tr key={w.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{w.worker_identity}</div>
                        <div className="text-[10px] text-texter-text-muted truncate max-w-[120px]">
                          v{w.version || "1.0"}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-texter-cyan truncate max-w-[140px]">
                        {w.instance_identity}
                      </td>
                      <td className="py-3 px-4">
                        <DecisionBadge decision={w.status} />
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-white font-medium">{w.current_concurrency}</span>
                        <span className="text-texter-text-muted"> / {w.max_concurrency}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            w.activeLeasesCount > 0 ? "text-emerald-400" : "text-texter-text-muted"
                          }`}
                        >
                          {w.activeLeasesCount}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(w.capabilities || []).map((cap) => (
                            <span
                              key={cap}
                              className="text-[9px] px-1.5 py-0.2 rounded bg-texter-surface-subtle border border-texter-border text-texter-text-muted"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-texter-text-muted">
                        {w.last_heartbeat_at ? new Date(w.last_heartbeat_at).toLocaleTimeString() : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {w.status === "HEALTHY" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openActionModal(w, "drain")}
                              className="text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 px-2 py-1 h-auto"
                            >
                              Drain
                            </Button>
                          )}
                          {w.status !== "QUARANTINED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openActionModal(w, "quarantine")}
                              className="text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 h-auto"
                            >
                              Quarantine
                            </Button>
                          )}
                          {w.status === "QUARANTINED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openActionModal(w, "release_quarantine")}
                              className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 px-2 py-1 h-auto"
                            >
                              Release quarantine
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={modalState.title}
        description={modalState.description}
        resourceType="worker"
        resourceId={modalState.workerIdentity}
        workspaceId={modalState.workspaceId}
        impact={modalState.impact}
        actionLabel="Confirmar Operación"
        isLoading={isExecutingAction}
        variant={modalState.action === "quarantine" ? "danger" : "warning"}
      />
    </DashboardShell>
  );
}
