"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  BarChart3,
  DollarSign,
  Clock,
  CheckCircle2,
  Cpu,
  Activity,
  RefreshCw,
  Lock,
  ArrowRight,
  Loader2,
  Building2,
  TrendingUp,
  Calendar,
  ShoppingBag,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface RevenueClientItem {
  client_id: string;
  client_name: string;
  paid_total: number;
  pending_total: number;
  by_kind: {
    subscription: { paid: number; pending: number };
    consumption: { paid: number; pending: number };
  };
  periods: Record<string, { paid: number; pending: number }>;
}

interface ConsumptionClientItem {
  client_id: string;
  client_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface HealthClientItem {
  client_id: string;
  client_name: string;
  ok_checks: number;
  total_checks: number;
  uptime_pct: number | null;
}

interface BusinessMetricsClientItem {
  client_id: string;
  client_name: string;
  metrics: {
    visits: number;
    sales: number;
    orders: number;
    revenue: number;
  };
  // Qué métricas reportó realmente el satélite: una métrica nunca
  // reportada se muestra como "—", no como 0.
  reported?: {
    visits: boolean;
    sales: boolean;
    orders: boolean;
    revenue: boolean;
  };
  currency: string | null;
  has_data: boolean;
}

interface MonthlyPeriodItem {
  period: string;
  paid_total: number;
  pending_total: number;
  paid_by_currency?: Record<string, number>;
  pending_by_currency?: Record<string, number>;
}

interface AnalyticsData {
  summary: {
    paid_last_30d: number;
    pending_total: number;
    mrr: Record<string, number>;
    active_subscriptions_count: number;
  };
  revenue_by_client: RevenueClientItem[];
  mrr: Record<string, number>;
  consumption_by_client: ConsumptionClientItem[];
  health_by_client: HealthClientItem[];
  business_metrics_by_client: BusinessMetricsClientItem[];
  monthly_periods: MonthlyPeriodItem[];
}

export default function AdminAnaliticaPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch("/api/admin/analytics");

      if (res.status === 401 || res.status === 403) {
        setIsSuperAdmin(false);
        return false;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo cargar la analítica central."
        );
      }

      const json = await res.json();
      setData(json);
      setIsSuperAdmin(true);
      return true;
    } catch (err: any) {
      console.error("Error al cargar /api/admin/analytics:", err);
      setErrorMsg(
        err?.message || "Error al sincronizar los agregados de analítica."
      );
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await fetchAnalytics();
      setLoading(false);
    }
    init();
  }, [fetchAnalytics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <DashboardShell
        title="Analítica — Inteligencia Central de Negocio"
        subtitle="Ingresos recurrentes, facturación por período, consumo de IA, uptime VIGÍA y métricas de satélites"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Consolidando métricas financieras, consumo y salud...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="Analítica — Inteligencia Central de Negocio"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-texter-surface border border-texter-border text-center space-y-4 shadow-texter-card">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de NEXTEХ. Tu usuario no posee permisos para consultar la analítica central de negocio.
          </p>
          <div className="pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-texter-surface-hover hover:bg-texter-border text-xs font-semibold text-white transition-colors"
            >
              <span>Volver al Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const mrrUsd = Number(data?.mrr?.USD ?? data?.summary?.mrr?.USD ?? 0);
  const mrrDop = Number(data?.mrr?.DOP ?? data?.summary?.mrr?.DOP ?? 0);
  const paid30d = Number(data?.summary?.paid_last_30d ?? 0);
  const pendingTotal = Number(data?.summary?.pending_total ?? 0);
  const activeSubsCount = Number(
    data?.summary?.active_subscriptions_count ?? 0
  );

  // Unificar filas por cliente a partir de las 4 colecciones
  const clientIds = Array.from(
    new Set([
      ...(data?.revenue_by_client || []).map((r) => r.client_id),
      ...(data?.consumption_by_client || []).map((c) => c.client_id),
      ...(data?.health_by_client || []).map((h) => h.client_id),
      ...(data?.business_metrics_by_client || []).map((b) => b.client_id),
    ])
  );

  const clientRows = clientIds.map((cid) => {
    const rev = (data?.revenue_by_client || []).find(
      (r) => r.client_id === cid
    );
    const cons = (data?.consumption_by_client || []).find(
      (c) => c.client_id === cid
    );
    const health = (data?.health_by_client || []).find(
      (h) => h.client_id === cid
    );
    const bm = (data?.business_metrics_by_client || []).find(
      (b) => b.client_id === cid
    );

    const clientName =
      rev?.client_name ||
      cons?.client_name ||
      health?.client_name ||
      bm?.client_name ||
      "Cliente";

    return {
      client_id: cid,
      client_name: clientName,
      paid_total: rev?.paid_total ?? 0,
      pending_total: rev?.pending_total ?? 0,
      by_kind: rev?.by_kind ?? {
        subscription: { paid: 0, pending: 0 },
        consumption: { paid: 0, pending: 0 },
      },
      total_tokens: cons?.total_tokens ?? 0,
      uptime_pct: health?.uptime_pct ?? null,
      ok_checks: health?.ok_checks ?? 0,
      total_checks: health?.total_checks ?? 0,
      business: bm ?? null,
    };
  });

  const monthlyPeriods = data?.monthly_periods || [];

  return (
    <DashboardShell
      title="Analítica — Inteligencia Central de Negocio"
      subtitle="Ingresos recurrentes, facturación por período, consumo de IA, uptime VIGÍA y métricas de satélites"
    >
      <AdminNav />

      <div className="space-y-6">
        {errorMsg && (
          <div className="p-4 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center justify-between gap-2">
            <span>{errorMsg}</span>
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              Reintentar
            </Button>
          </div>
        )}

        {/* 1. Tarjetas Resumen */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-emerald-400">
                Ingresos Pagados (30 días)
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              $
              {paid30d.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Facturas liquidadas en los últimos 30 días
            </p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-amber-400">
                Ingresos Pendientes
              </span>
              <Clock className="w-4 h-4 text-texter-amber" />
            </div>
            <div className="text-2xl font-bold text-amber-400 font-mono">
              $
              {pendingTotal.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Total por cobrar (suscripción + consumo)
            </p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">MRR por Moneda</span>
              <DollarSign className="w-4 h-4 text-texter-indigo" />
            </div>
            <div className="space-y-0.5 font-mono">
              <div className="text-xl font-bold text-white">
                $
                {mrrUsd.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-xs font-normal text-texter-cyan">
                  USD
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-300">
                RD$
                {mrrDop.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-[11px] font-normal text-texter-text-muted">
                  DOP
                </span>
              </div>
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Renta mensual activa
            </p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-texter-cyan">
                Clientes con Suscripción Activa
              </span>
              <TrendingUp className="w-4 h-4 text-texter-cyan" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">
              {activeSubsCount}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Suscripciones en estado active
            </p>
          </div>
        </div>

        {/* 2. Tabla consolidada por Cliente */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-texter-indigo" />
                <span>Desempeño por Cliente y Satélite</span>
                <Badge variant="indigo" size="sm">
                  {clientRows.length}
                </Badge>
              </h3>
              <p className="text-xs text-texter-text-muted">
                Facturación (6 períodos), consumo de tokens (30d), disponibilidad HTTP en VIGÍA (7d) y métricas operativas de negocio (30d).
              </p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-2 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-texter-text-secondary hover:text-white text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 self-start sm:self-auto"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
              />
              <span>{refreshing ? "Actualizando..." : "Actualizar"}</span>
            </button>
          </div>

          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {clientRows.length === 0 ? (
              <div className="p-12 text-center text-xs text-texter-text-muted">
                No hay clientes registrados para mostrar analítica.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                      <th className="py-3 px-4 font-semibold">Cliente</th>
                      <th className="py-3 px-4 font-semibold">Pagado</th>
                      <th className="py-3 px-4 font-semibold">Pendiente</th>
                      <th className="py-3 px-4 font-semibold">
                        Consumo Tokens (30d)
                      </th>
                      <th className="py-3 px-4 font-semibold">
                        Uptime VIGÍA (7d)
                      </th>
                      <th className="py-3 px-4 font-semibold">
                        Ventas / Pedidos / Visitas (30d)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/40">
                    {clientRows.map((row) => {
                      const hasBm = Boolean(row.business?.has_data);
                      const bmMetrics = row.business?.metrics || {
                        visits: 0,
                        sales: 0,
                        orders: 0,
                        revenue: 0,
                      };

                      return (
                        <tr
                          key={row.client_id}
                          className="hover:bg-texter-surface-hover/30 transition-colors"
                        >
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2 font-bold text-white text-sm">
                              <Building2 className="w-3.5 h-3.5 text-texter-cyan shrink-0" />
                              <span>{row.client_name}</span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                            <div className="font-bold text-emerald-400">
                              $
                              {row.paid_total.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-[10px] text-texter-text-dim">
                              Sub: ${row.by_kind.subscription.paid.toFixed(2)} •
                              IA: ${row.by_kind.consumption.paid.toFixed(2)}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                            <div
                              className={cn(
                                "font-bold",
                                row.pending_total > 0
                                  ? "text-amber-400"
                                  : "text-slate-400"
                              )}
                            >
                              $
                              {row.pending_total.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-[10px] text-texter-text-dim">
                              Sub: $
                              {row.by_kind.subscription.pending.toFixed(2)} •
                              IA: ${row.by_kind.consumption.pending.toFixed(2)}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                            <div className="flex items-center gap-1.5 text-white font-semibold">
                              <Cpu className="w-3.5 h-3.5 text-texter-indigo shrink-0" />
                              <span>
                                {row.total_tokens.toLocaleString("en-US")}
                              </span>
                            </div>
                            <span className="text-[10px] text-texter-text-dim">
                              tokens procesados
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                            {row.uptime_pct !== null ? (
                              <div className="space-y-0.5">
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[11px] font-bold border inline-flex items-center gap-1",
                                    row.uptime_pct >= 98
                                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                      : row.uptime_pct >= 90
                                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                      : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                  )}
                                >
                                  <Activity className="w-3 h-3" />
                                  {row.uptime_pct.toFixed(1)}%
                                </span>
                                <div className="text-[10px] text-texter-text-dim">
                                  {row.ok_checks}/{row.total_checks} checks ok
                                </div>
                              </div>
                            ) : (
                              <span className="text-texter-text-dim italic text-[11px]">
                                Sin chequeos
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {hasBm ? (
                              <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
                                <span className="px-2 py-0.5 rounded bg-texter-indigo/15 text-indigo-300 border border-indigo-500/30">
                                  Pedidos: <strong>{row.business?.reported?.orders ?? true ? bmMetrics.orders : "—"}</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Ventas: <strong>{row.business?.reported?.sales ?? true ? bmMetrics.sales : "—"}</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                  Visitas: <strong>{row.business?.reported?.visits ?? true ? bmMetrics.visits : "—"}</strong>
                                </span>
                                {bmMetrics.revenue > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    Revenue:{" "}
                                    <strong>
                                      ${bmMetrics.revenue.toLocaleString("en-US")}{" "}
                                      {row.business?.currency || ""}
                                    </strong>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-texter-text-dim italic flex items-center gap-1.5">
                                <ShoppingBag className="w-3.5 h-3.5 text-texter-text-dim shrink-0" />
                                <span>
                                  sin datos aún — los satélites reportan en la siguiente fase
                                </span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 3. Tabla Mensual (Últimos 6 períodos) */}
        <div className="space-y-4 pt-6 border-t border-texter-border">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Calendar className="w-4 h-4 text-texter-cyan" />
              <span>Evolución Mensual de Facturación (Últimos 6 Períodos)</span>
            </h3>
            <p className="text-xs text-texter-text-muted">
              Comparativa histórica de montos cobrados frente a saldos pendientes por período contable (YYYY-MM).
            </p>
          </div>

          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                    <th className="py-3 px-4 font-semibold">Período</th>
                    <th className="py-3 px-4 font-semibold">Total Pagado</th>
                    <th className="py-3 px-4 font-semibold">Total Pendiente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-texter-border/40 font-mono">
                  {monthlyPeriods.map((mp) => (
                    <tr
                      key={mp.period}
                      className="hover:bg-texter-surface-hover/30 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-bold text-white">
                        {mp.period}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-emerald-400">
                        $
                        {Number(mp.paid_total || 0).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td
                        className={cn(
                          "py-3.5 px-4 font-semibold",
                          Number(mp.pending_total || 0) > 0
                            ? "text-amber-400"
                            : "text-slate-400"
                        )}
                      >
                        $
                        {Number(mp.pending_total || 0).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
