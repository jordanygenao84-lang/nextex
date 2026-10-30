"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  Users,
  MessageSquare,
  Zap,
  TrendingUp,
  Receipt,
  Lock,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";

interface OverviewMetrics {
  total_clients: number;
  active_clients: number;
  conversations_today: number;
  conversations_by_status: { bot: number; human: number; paused: number };
  tokens_this_month: number;
  cache_hit_rate: number;
  pending_invoices_count: number;
  pending_invoices_amount: number;
  recent_conversations: Array<{
    id: string;
    client_name: string;
    channel: string;
    visitor_name: string;
    last_message_at: string | null;
  }>;
}

export default function AdminOverviewPage() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const authRes = await fetch("/api/auth/me");
        if (!authRes.ok) {
          setIsSuperAdmin(false);
          setLoading(false);
          return;
        }
        const authData = await authRes.json();
        if (!authData.is_super_admin) {
          setIsSuperAdmin(false);
          setLoading(false);
          return;
        }
        setIsSuperAdmin(true);

        const overviewRes = await fetch("/api/admin/overview");
        if (overviewRes.ok) {
          const data = await overviewRes.json();
          setMetrics(data);
        }
      } catch (err) {
        console.error("Error al cargar overview:", err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) {
    return (
      <DashboardShell
        title="Panel de Administración"
        subtitle="Métricas globales y operaciones de la plataforma NEXTEХ"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Verificando credenciales de superadministrador...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="Área administrativa de NEXTEХ"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl nextex-panel bg-texter-surface border border-texter-border text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de la plataforma. Si requieres acceso, contacta al propietario del sistema.
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

  return (
    <DashboardShell
      title="Panel de Administración"
      subtitle="Métricas globales y operaciones de la plataforma NEXTEХ"
    >
      <AdminNav />

      <div className="space-y-6">
        {/* Banner de Super Admin */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-texter-surface to-texter-surface-elevated border border-texter-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-texter-indigo/10 border border-texter-indigo/30 flex items-center justify-center text-texter-indigo">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Super Administrador Activo</h2>
              <p className="text-[11px] text-texter-text-muted">
                Control global de clientes, satélites, facturación y telemetría de IA.
              </p>
            </div>
          </div>
          <Link
            href="/admin/vigilancia"
            className="px-3.5 py-2 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-texter-glow-indigo"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Ir a Vigilancia Web</span>
          </Link>
        </div>

        {/* Métricas Globales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Clientes Activos</span>
              <Users className="w-4 h-4 text-texter-cyan" />
            </div>
            <div className="text-2xl font-bold text-white font-mono nextex-gradient-text">
              {metrics?.active_clients ?? 0}
              <span className="text-xs text-texter-text-muted font-normal ml-1.5">
                / {metrics?.total_clients ?? 0} totales
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Conversaciones Hoy</span>
              <MessageSquare className="w-4 h-4 text-texter-indigo" />
            </div>
            <div className="text-2xl font-bold text-white font-mono nextex-gradient-text">
              {metrics?.conversations_today ?? 0}
            </div>
            <div className="text-[11px] text-texter-text-muted">
              Bot: {metrics?.conversations_by_status.bot ?? 0} • Humano: {metrics?.conversations_by_status.human ?? 0}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Cache Hit Rate</span>
              <Zap className="w-4 h-4 text-texter-emerald" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              {((metrics?.cache_hit_rate ?? 0) * 100).toFixed(1)}%
            </div>
            <div className="text-[11px] text-texter-text-muted">
              Tubería directa sin costo de IA
            </div>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Facturación Pendiente</span>
              <Receipt className="w-4 h-4 text-texter-amber" />
            </div>
            <div className="text-2xl font-bold text-amber-400 font-mono">
              ${(metrics?.pending_invoices_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-texter-text-muted">
              {metrics?.pending_invoices_count ?? 0} facturas por cobrar
            </div>
          </div>
        </div>

        {/* Consumo y Conversaciones Recientes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl nextex-panel bg-texter-surface border border-texter-border space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-texter-indigo" />
              <span>Consumo Global del Mes</span>
            </h3>
            <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
              <div className="text-xs text-texter-text-muted">Tokens procesados este mes</div>
              <div className="text-3xl font-bold text-white font-mono nextex-gradient-text">
                {(metrics?.tokens_this_month ?? 0).toLocaleString()}
              </div>
              <p className="text-[11px] text-texter-text-muted">
                Calculado sobre todos los clientes y satélites conectados.
              </p>
            </div>
          </div>

          <div className="p-5 rounded-2xl nextex-panel bg-texter-surface border border-texter-border space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-texter-cyan" />
              <span>Últimas Conversaciones</span>
            </h3>
            {metrics?.recent_conversations && metrics.recent_conversations.length > 0 ? (
              <div className="space-y-2">
                {metrics.recent_conversations.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{c.client_name}</span>
                      <span className="text-texter-text-muted ml-2">({c.visitor_name})</span>
                    </div>
                    <Badge variant="cyan" size="sm">
                      {c.channel}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-texter-text-muted italic">No hay conversaciones recientes.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
