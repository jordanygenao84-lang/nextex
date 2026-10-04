"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import {
  Server,
  Cpu,
  RefreshCw,
  ShieldCheck,
  FileText,
  AlertOctagon,
  RefreshCcw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface StatsData {
  workspaceId: string;
  userRole: string;
  workers: {
    total: number;
    healthy: number;
    starting: number;
    draining: number;
    stale: number;
    quarantined: number;
    stopped: number;
  };
  jobs: {
    total: number;
    queued: number;
    claimed: number;
    running: number;
    waiting_approval: number;
    completed: number;
    failed: number;
    cancelled: number;
    dead_letter: number;
  };
  recovery: {
    total_leases: number;
    active_leases: number;
    expired_leases: number;
    recovery_attempts: number;
    fencing_events: number;
    recovery_failures: number;
  };
  governance: {
    total_evaluations: number;
    allowed: number;
    denied: number;
    requires_approval: number;
    blocked: number;
    expired: number;
  };
  cancellation: {
    requested: number;
    cancelling: number;
    cancelled: number;
    failed_cancellation: number;
  };
  timestamp: string;
}

export default function ControlPlaneDashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/control-plane/stats");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "Error al cargar estadísticas del Control Plane");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <DashboardShell
      title="Production Control Plane"
      subtitle="Supervisión operacional, gobernanza de workers, jobs resilientes y auditoría inmutable"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        {/* Cabecera operacional y botón de refresco */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-texter-surface border border-texter-border rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-texter-indigo border border-indigo-500/20">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-white font-semibold text-base sm:text-lg">
                  Estado Operacional del Cluster
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  LIVE FASE 4.10
                </span>
              </div>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Workspace ID: <span className="font-mono text-texter-cyan">{stats?.workspaceId || "—"}</span> | Rol:{" "}
                <span className="font-mono uppercase text-texter-indigo">{stats?.userRole || "—"}</span>
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            disabled={isLoading}
            className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 6 Paneles Operacionales Principales */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 1. WORKERS */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-texter-cyan" />
                <h3 className="font-semibold text-white text-sm">Workers Cluster</h3>
              </div>
              <span className="text-xs font-mono text-texter-text-muted">
                Total: <strong className="text-white">{stats?.workers.total ?? "—"}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-emerald-400">Healthy</span>
                <span className="font-bold text-white">{stats?.workers.healthy ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-amber-400">Draining</span>
                <span className="font-bold text-white">{stats?.workers.draining ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-gray-400">Starting</span>
                <span className="font-bold text-white">{stats?.workers.starting ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-rose-400">Stopped</span>
                <span className="font-bold text-white">{stats?.workers.stopped ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-yellow-400">Stale</span>
                <span className="font-bold text-white">{stats?.workers.stale ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-purple-400">Quarantine</span>
                <span className="font-bold text-white">{stats?.workers.quarantined ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 2. JOBS & RUNS */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-texter-indigo" />
                <h3 className="font-semibold text-white text-sm">Jobs & Encolamiento</h3>
              </div>
              <span className="text-xs font-mono text-texter-text-muted">
                Total Runs: <strong className="text-white">{stats?.jobs.total ?? "—"}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-cyan-400">Queued</span>
                <span className="font-bold text-white">{stats?.jobs.queued ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-indigo-400">Running</span>
                <span className="font-bold text-white">{stats?.jobs.running ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-amber-400">Waiting HITL</span>
                <span className="font-bold text-white">{stats?.jobs.waiting_approval ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-emerald-400">Completed</span>
                <span className="font-bold text-white">{stats?.jobs.completed ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-rose-400">Failed</span>
                <span className="font-bold text-white">{stats?.jobs.failed ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-purple-400">Dead Letter</span>
                <span className="font-bold text-white">{stats?.jobs.dead_letter ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 3. RECOVERY & LEASES */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white text-sm">Resiliencia & Leases</h3>
              </div>
              <span className="text-xs font-mono text-texter-text-muted">
                Leases: <strong className="text-white">{stats?.recovery.total_leases ?? "—"}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-emerald-400">Activos</span>
                <span className="font-bold text-white">{stats?.recovery.active_leases ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-rose-400">Expirados</span>
                <span className="font-bold text-white">{stats?.recovery.expired_leases ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-indigo-400">Fencing Events</span>
                <span className="font-bold text-white">{stats?.recovery.fencing_events ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-amber-400">Reintentos</span>
                <span className="font-bold text-white">{stats?.recovery.recovery_attempts ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 4. GOVERNANCE & AUTORIDAD */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-white text-sm">Decisiones Gobernanza</h3>
              </div>
              <span className="text-xs font-mono text-texter-text-muted">
                Evaluaciones: <strong className="text-white">{stats?.governance.total_evaluations ?? "—"}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-emerald-400">ALLOW</span>
                <span className="font-bold text-white">{stats?.governance.allowed ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-rose-400">DENY</span>
                <span className="font-bold text-white">{stats?.governance.denied ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-amber-400">REQ_APPROVAL</span>
                <span className="font-bold text-white">{stats?.governance.requires_approval ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-purple-400">BLOCKED</span>
                <span className="font-bold text-white">{stats?.governance.blocked ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 5. CANCELLATION */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-400" />
                <h3 className="font-semibold text-white text-sm">Cancelación Durable</h3>
              </div>
              <span className="text-xs font-mono text-texter-text-muted">
                Cancelados: <strong className="text-white">{stats?.cancellation.cancelled ?? 0}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-amber-400">Requested</span>
                <span className="font-bold text-white">{stats?.cancellation.requested ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-cyan-400">Cancelling</span>
                <span className="font-bold text-white">{stats?.cancellation.cancelling ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-rose-400">Cancelled</span>
                <span className="font-bold text-white">{stats?.cancellation.cancelled ?? 0}</span>
              </div>
              <div className="bg-texter-surface-subtle border border-texter-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-gray-400">Failed</span>
                <span className="font-bold text-white">{stats?.cancellation.failed_cancellation ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 6. AUDITORÍA INMUTABLE */}
          <div className="bg-texter-surface border border-texter-border rounded-2xl p-5 space-y-4 hover:border-texter-border/80 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-white text-sm">Auditoría Append-Only</h3>
              </div>
              <span className="text-xs font-mono text-emerald-400">Trigger 55000</span>
            </div>

            <div className="space-y-2 text-xs text-texter-text-muted">
              <p>
                Todos los eventos de gobernanza, cancelación y recuperación son registrados de forma
                estrictamente inmutable con sanitización recursiva de secretos.
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-texter-border/50 font-mono">
                <span>Sanitización:</span>
                <span className="text-emerald-400 font-semibold">ACTIVA (H6)</span>
              </div>
              <div className="flex items-center justify-between font-mono">
                <span>Inmutabilidad:</span>
                <span className="text-cyan-400 font-semibold">ENFORCED (Trigger 55000)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
