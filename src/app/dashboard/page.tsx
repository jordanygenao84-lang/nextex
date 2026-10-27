"use client";

import React, { useEffect, useState } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { JobsTable } from "@/components/dashboard/JobsTable";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AgentStatusList } from "@/components/dashboard/AgentStatusList";
import { QuickActions } from "@/components/dashboard/QuickActions";
import type { MetricItem } from "@/lib/mock-data";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Sparkles, Building, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { user, profile, workspace, isLoading } = useAuth();

  // Obtener primer nombre real del usuario autenticado
  const fullName = profile?.full_name || user?.email?.split("@")[0] || "Jordany";
  const firstName = fullName.trim().split(" ")[0];
  const userPlan = isLoading ? "—" : (profile?.plan || "free").toUpperCase();

  // Saludo según la hora
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Buenos días" : currentHour < 19 ? "Buenas tardes" : "Buenas noches";

  // Métricas reales desde /api/admin/overview (antes eran MOCK_METRICS
  // fijos: 1.42M tokens, 3,892 tareas, etc.). Si la consulta falla, las
  // tarjetas quedan en "—": nunca se vuelve a mostrar un número inventado.
  const [metrics, setMetrics] = useState<MetricItem[]>([
    { id: "m-tokens", label: "Tokens procesados", value: "—", change: "", isPositive: true, timeframe: "mes actual", iconName: "Cpu" },
    { id: "m-clients", label: "Clientes activos", value: "—", change: "", isPositive: true, timeframe: "en plataforma", iconName: "Workflow" },
    { id: "m-convs", label: "Conversaciones hoy", value: "—", change: "", isPositive: true, timeframe: "hoy", iconName: "CheckCircle2" },
    { id: "m-invoices", label: "Facturas pendientes", value: "—", change: "", isPositive: true, timeframe: "por cobrar", iconName: "Zap" },
  ]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || cancelled) return;
        setMetrics([
          { id: "m-tokens", label: "Tokens procesados", value: String(d.tokens_this_month ?? 0), change: "", isPositive: true, timeframe: "mes actual", iconName: "Cpu" },
          { id: "m-clients", label: "Clientes activos", value: `${d.active_clients ?? 0}/${d.total_clients ?? 0}`, change: "", isPositive: true, timeframe: "en plataforma", iconName: "Workflow" },
          { id: "m-convs", label: "Conversaciones hoy", value: String(d.conversations_today ?? 0), change: "", isPositive: true, timeframe: "hoy", iconName: "CheckCircle2" },
          { id: "m-invoices", label: "Facturas pendientes", value: `$${Number(d.pending_invoices_amount ?? 0).toFixed(2)}`, change: "", isPositive: true, timeframe: `${d.pending_invoices_count ?? 0} por cobrar`, iconName: "Zap" },
        ]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardShell
      title="Centro de Operaciones y Telemetría"
      subtitle="Monitoreo de agentes autónomos, pipelines y consumo en tiempo real"
    >
      <div className="space-y-6">
        {/* Real User Welcome Banner */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-texter-surface to-texter-surface-elevated border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-bold text-white tracking-tight">
                {greeting}, {firstName}
              </span>
              <Badge variant={userPlan === "PRO" ? "indigo" : "cyan"} size="sm">
                Plan {userPlan}
              </Badge>
            </div>
            <p className="text-xs text-texter-text-muted flex items-center gap-2 flex-wrap">
              <span>Espacio de Trabajo:</span>
              <span className="text-white font-medium flex items-center gap-1 font-mono">
                <Building className="w-3.5 h-3.5 text-texter-cyan" />
                {workspace?.name || `${firstName} Workspace`}
              </span>
              <span className="text-texter-border">•</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Aislamiento RLS Activo
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link href="/chat">
              <button className="px-3.5 py-2 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-texter-glow-indigo">
                <Sparkles className="w-3.5 h-3.5 text-white" />
                <span>Iniciar Tarea Autónoma</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
        </div>

        {/* Top Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.id} item={metric} />
          ))}
        </div>

        {/* Quick Action Shortcuts */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono">
            Acciones Rápidas del Sistema
          </h2>
          <QuickActions />
        </div>

        {/* Main Jobs Table */}
        <JobsTable />

        {/* Two-column layout: Active Agents & System Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <AgentStatusList />
          </div>
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
