"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import {
  RefreshCw,
  AlertTriangle,
  Radio,
  Server,
  FileText,
  Clock,
  ShieldAlert,
  Play,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface StaleWorker {
  id: string;
  worker_identity: string;
  status: string;
  last_heartbeat_at: string;
}

interface ExpiredLease {
  id: string;
  worker_id: string;
  job_run_id: string;
  fencing_token: number;
  expires_at: string;
  status: string;
  workers?: { worker_identity: string };
  job_runs?: { id: string; status: string; fencing_token: number };
}

export default function RecoveryControlPage() {
  const [staleWorkers, setStaleWorkers] = useState<StaleWorker[]>([]);
  const [expiredLeases, setExpiredLeases] = useState<ExpiredLease[]>([]);
  const [recoveryEvents, setRecoveryEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchRecoveryData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/control-plane/recovery");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setStaleWorkers(data.staleWorkers || []);
      setExpiredLeases(data.expiredLeases || []);
      setRecoveryEvents(data.recoveryEvents || []);
    } catch (err: any) {
      setError(err.message || "Error al cargar datos de recuperación");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecoveryData();
  }, []);

  const handleTriggerRecovery = async () => {
    try {
      setIsRecovering(true);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch("/api/control-plane/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error?.message || `Error al ejecutar recuperación (${res.status})`);
      }

      setSuccessMessage(
        `Ciclo de recuperación completado con éxito: ${resJson.result?.recoveredJobsCount ?? 0} jobs recuperados.`
      );
      await fetchRecoveryData();
    } catch (err: any) {
      setError(err.message || "Error al ejecutar el ciclo de recuperación");
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <DashboardShell
      title="Motor de Recuperación & Resiliencia"
      subtitle="Detección de latidos caídos, expiración forzada de leases, incremento de fencing y recuperación ordenada"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-texter-surface border border-texter-border rounded-2xl p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-emerald-400" />
              <h2 className="text-white font-semibold text-base sm:text-lg">
                Recuperación Autoritativa del Control Plane
              </h2>
            </div>
            <p className="text-xs text-texter-text-muted mt-1">
              Ejecuta barreras de reanudación y cerca workers zombis mediante tokens monótonos.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="primary"
              size="sm"
              onClick={handleTriggerRecovery}
              disabled={isRecovering || isLoading}
              className="flex items-center gap-2 text-xs font-mono bg-texter-emerald hover:bg-emerald-600 text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecovering ? "animate-spin" : ""}`} />
              Ejecutar Ciclo de Recuperación
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchRecoveryData}
              disabled={isLoading}
              className="border border-texter-border text-xs font-mono"
            >
              Sincronizar
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Paneles de Monitoreo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-mono text-xs">
          {/* Workers Stale o Cuarentena */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-white">Workers Stale / Cuarentena</h3>
              </div>
              <span className="text-xs text-texter-text-muted">({staleWorkers.length})</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {staleWorkers.length === 0 ? (
                <p className="text-texter-text-muted text-[11px] py-4 text-center">
                  Todos los workers están respondiendo a tiempo.
                </p>
              ) : (
                staleWorkers.map((w) => (
                  <div
                    key={w.id}
                    className="p-2.5 rounded-lg bg-texter-surface-subtle border border-texter-border flex items-center justify-between text-[11px]"
                  >
                    <div>
                      <span className="text-white block font-medium">{w.worker_identity}</span>
                      <span className="text-[10px] text-texter-text-muted">
                        Último latido: {new Date(w.last_heartbeat_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <DecisionBadge decision={w.status} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Leases Expirados */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-rose-400" />
                <h3 className="font-semibold text-white">Leases Expirados</h3>
              </div>
              <span className="text-xs text-texter-text-muted">({expiredLeases.length})</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {expiredLeases.length === 0 ? (
                <p className="text-texter-text-muted text-[11px] py-4 text-center">
                  No hay leases expirados pendientes de rescate.
                </p>
              ) : (
                expiredLeases.map((l) => (
                  <div
                    key={l.id}
                    className="p-2.5 rounded-lg bg-texter-surface-subtle border border-texter-border flex items-center justify-between text-[11px]"
                  >
                    <div>
                      <span className="text-white block font-medium">JobRun: {l.job_run_id.slice(0, 8)}</span>
                      <span className="text-[10px] text-texter-text-muted">
                        Fencing Token: <strong className="text-texter-cyan">{l.fencing_token}</strong>
                      </span>
                    </div>
                    <DecisionBadge decision="expired" />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Timeline Canónico de Recuperación */}
        <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-texter-indigo" />
            <h3 className="text-white font-semibold text-sm">Flujo Canónico de Recuperación</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3 space-y-1">
              <span className="text-amber-400 font-bold block text-[10px]">1. DETECCIÓN</span>
              <p className="text-white">Heartbeat vencido (&gt;30s)</p>
              <p className="text-[10px] text-texter-text-muted">Worker transiciona a STALE</p>
            </div>
            <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3 space-y-1">
              <span className="text-rose-400 font-bold block text-[10px]">2. EXPIRACIÓN</span>
              <p className="text-white">Lease revocado</p>
              <p className="text-[10px] text-texter-text-muted">Libera autoridad del worker caído</p>
            </div>
            <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3 space-y-1">
              <span className="text-texter-cyan font-bold block text-[10px]">3. FENCING</span>
              <p className="text-white">Token incrementado (+1)</p>
              <p className="text-[10px] text-texter-text-muted">Invalida escrituras zombis tardías</p>
            </div>
            <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3 space-y-1">
              <span className="text-emerald-400 font-bold block text-[10px]">4. RE-CLAIM</span>
              <p className="text-white">Re-encolamiento en queued</p>
              <p className="text-[10px] text-texter-text-muted">Nuevo worker saludable reanuda run</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
