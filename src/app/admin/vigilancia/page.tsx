"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  Activity,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  RefreshCw,
  ExternalLink,
  Lock,
  ArrowRight,
  Loader2,
  Clock,
  Globe,
  Wifi,
  Server,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

interface ClientHealthItem {
  client_id: string;
  display_name: string;
  website_url: string | null;
  latest_check: {
    status: "ok" | "degraded" | "down" | string | null;
    response_ms: number | null;
    ssl_days_left: number | null;
    checked_at: string | null;
  } | null;
  unresolved_incidents: number;
}

interface IncidentItem {
  id: string;
  client_id: string | null;
  client_name: string;
  kind: string;
  title: string;
  detail: any;
  created_at: string;
}

interface FindingsCount {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

export default function VigilanciaPage() {
  const [clients, setClients] = useState<ClientHealthItem[]>([]);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [findingsCount, setFindingsCount] = useState<FindingsCount>({
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  });
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingNow, setCheckingNow] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchVigiaData = useCallback(async () => {
    try {
      const [healthRes, incRes] = await Promise.all([
        fetch("/api/vigia/health"),
        fetch("/api/vigia/incidents"),
      ]);

      if (healthRes.status === 401 || healthRes.status === 403 || incRes.status === 401 || incRes.status === 403) {
        setIsSuperAdmin(false);
        return false;
      }

      if (!healthRes.ok || !incRes.ok) {
        throw new Error("No se pudo obtener la información de salud de VIGÍA.");
      }

      const healthData = await healthRes.json();
      const incData = await incRes.json();

      setClients(Array.isArray(healthData) ? healthData : []);
      setIncidents(incData.incidents || []);
      setFindingsCount(
        incData.findings_count || { critical: 0, warning: 0, info: 0, total: 0 }
      );
      setLastUpdated(new Date().toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setIsSuperAdmin(true);
      return true;
    } catch (err: any) {
      console.error("Error al cargar VIGÍA:", err);
      setErrorMsg(err?.message || "Error al sincronizar con VIGÍA.");
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setErrorMsg(null);
      await fetchVigiaData();
      setLoading(false);
    }
    init();
  }, [fetchVigiaData]);

  const handleCheckNow = async () => {
    setCheckingNow(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/vigia/check-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Error al disparar el chequeo de salud.");
      }

      await fetchVigiaData();
    } catch (err: any) {
      setErrorMsg(err?.message || "Error al ejecutar 'Revisar ahora'.");
    } finally {
      setCheckingNow(false);
    }
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return "Nunca";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("es-DO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  if (loading) {
    return (
      <DashboardShell
        title="VIGÍA — Vigilancia Web & Satélites"
        subtitle="Centro maestro de telemetría, salud HTTP, certificados TLS y eventos de seguridad"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Consultando telemetría de VIGÍA en tiempo real...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="VIGÍA — Centro de Vigilancia"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-texter-surface border border-texter-border text-center space-y-4 shadow-texter-card">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de NEXTEХ. Tu usuario no posee permisos para consultar la telemetría de VIGÍA.
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
      title="VIGÍA — Vigilancia Web & Satélites"
      subtitle="Supervisión activa de salud HTTP, latencia, certificados TLS y eventos de seguridad"
    >
      <AdminNav />

      <div className="space-y-6">
        {/* Barra superior de control y estado */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-texter-surface to-texter-surface-elevated border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-texter-emerald animate-pulse" />
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                Monitor VIGÍA Activo
              </h2>
              <Badge variant="indigo" size="sm">
                v1.17
              </Badge>
            </div>
            <p className="text-xs text-texter-text-muted flex items-center gap-2 flex-wrap">
              <span>Sondeo automático:</span>
              <span className="text-texter-cyan font-mono font-medium">Cada minuto vía pg_cron</span>
              {lastUpdated && (
                <>
                  <span className="text-texter-border">•</span>
                  <span>Última sincronización: <strong className="text-white font-mono">{lastUpdated}</strong></span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCheckNow}
              disabled={checkingNow}
              className={cn(
                "px-3.5 py-2 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-texter-glow-indigo disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", checkingNow && "animate-spin")} />
              <span>{checkingNow ? "Verificando..." : "Revisar ahora"}</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-texter-rose" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Sección: Hallazgos de Seguridad (Contadores por Severidad) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-texter-cyan" />
              <span>Hallazgos de Seguridad Abiertos</span>
            </h3>
            <span className="text-[11px] font-mono text-texter-text-dim">
              Tabla: security_findings
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {/* Total */}
            <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium">Total Abiertos</span>
                <ShieldCheck className="w-4 h-4 text-texter-text-muted" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {findingsCount.total}
              </div>
              <p className="text-[10px] text-texter-text-muted">Hallazgos sin resolver</p>
            </div>

            {/* Críticos */}
            <div className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              findingsCount.critical > 0 ? "border-rose-500/50 bg-rose-500/5" : "border-texter-border"
            )}>
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium text-rose-400">Críticos</span>
                <XCircle className="w-4 h-4 text-texter-rose" />
              </div>
              <div className="text-2xl font-bold text-rose-400 font-mono">
                {findingsCount.critical}
              </div>
              <p className="text-[10px] text-texter-text-muted">Acción inmediata requerida</p>
            </div>

            {/* Advertencias */}
            <div className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              findingsCount.warning > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-texter-border"
            )}>
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium text-amber-400">Advertencias</span>
                <AlertTriangle className="w-4 h-4 text-texter-amber" />
              </div>
              <div className="text-2xl font-bold text-amber-400 font-mono">
                {findingsCount.warning}
              </div>
              <p className="text-[10px] text-texter-text-muted">Riesgos potenciales</p>
            </div>

            {/* Informativos */}
            <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium text-cyan-400">Informativos</span>
                <Info className="w-4 h-4 text-texter-cyan" />
              </div>
              <div className="text-2xl font-bold text-cyan-400 font-mono">
                {findingsCount.info}
              </div>
              <p className="text-[10px] text-texter-text-muted">Observaciones y avisos</p>
            </div>
          </div>
        </div>

        {/* Sección: Semáforo de Clientes y Satélites */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-texter-indigo" />
              <span>Estado de Clientes y Satélites Conectados ({clients.length})</span>
            </h3>
            <span className="text-[11px] font-mono text-texter-text-dim">
              Umbrales: OK &lt;2.5s • Degradado ≥2.5s • Caído 5xx/Timeout
            </span>
          </div>

          {clients.length === 0 ? (
            <div className="p-8 rounded-2xl bg-texter-surface border border-texter-border text-center text-xs text-texter-text-muted">
              No hay clientes activos registrados en la plataforma.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((c) => {
                const check = c.latest_check;
                const status = check?.status;

                // Definición visual de semáforo
                let statusLabel = "Sin chequeos aún";
                let statusColor = "text-slate-400";
                let dotColor = "bg-slate-500";
                let badgeStyle = "bg-slate-800/80 text-slate-300 border-slate-700";
                let cardBorder = "border-texter-border";

                if (status === "ok") {
                  statusLabel = "Operativo";
                  statusColor = "text-emerald-400";
                  dotColor = "bg-emerald-400 animate-pulse";
                  badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                  cardBorder = "border-emerald-500/20 hover:border-emerald-500/40";
                } else if (status === "degraded") {
                  statusLabel = "Degradado";
                  statusColor = "text-amber-400";
                  dotColor = "bg-amber-400 animate-pulse";
                  badgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/30";
                  cardBorder = "border-amber-500/20 hover:border-amber-500/40";
                } else if (status === "down") {
                  statusLabel = "Caído";
                  statusColor = "text-rose-400";
                  dotColor = "bg-rose-400 animate-pulse";
                  badgeStyle = "bg-rose-500/10 text-rose-400 border-rose-500/30";
                  cardBorder = "border-rose-500/40 hover:border-rose-500/60 bg-rose-500/[0.02]";
                }

                const sslDays = check?.ssl_days_left;
                const isSslExpiring = sslDays !== null && sslDays !== undefined && sslDays <= 15;

                return (
                  <div
                    key={c.client_id}
                    className={cn(
                      "p-5 rounded-2xl bg-texter-surface border transition-all duration-200 flex flex-col justify-between space-y-4",
                      cardBorder
                    )}
                  >
                    {/* Header de la tarjeta */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-bold text-white tracking-tight truncate">
                          {c.display_name}
                        </h4>
                        <span
                          className={cn(
                            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border flex items-center gap-1.5 shrink-0",
                            badgeStyle
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full", dotColor)} />
                          <span>{statusLabel}</span>
                        </span>
                      </div>

                      {c.website_url ? (
                        <a
                          href={c.website_url.startsWith("http") ? c.website_url : `https://${c.website_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-texter-text-muted hover:text-texter-cyan transition-colors flex items-center gap-1 truncate font-mono"
                          title={c.website_url}
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate">{c.website_url.replace(/^https?:\/\//, "")}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs text-texter-text-dim italic">Sin URL asignada</span>
                      )}
                    </div>

                    {/* Métricas clave */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-texter-border/50 text-xs font-mono">
                      <div className="p-2 rounded-xl bg-texter-surface-subtle border border-texter-border/40 space-y-0.5">
                        <span className="text-[10px] text-texter-text-dim block">Latencia</span>
                        <span className={cn("font-semibold text-sm", check?.response_ms ? "text-white" : "text-texter-text-dim")}>
                          {check?.response_ms !== null && check?.response_ms !== undefined ? `${check.response_ms} ms` : "—"}
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-texter-surface-subtle border border-texter-border/40 space-y-0.5">
                        <span className="text-[10px] text-texter-text-dim block">SSL Vence</span>
                        <span
                          className={cn(
                            "font-semibold text-sm",
                            isSslExpiring
                              ? "text-amber-400"
                              : sslDays !== null && sslDays !== undefined
                              ? "text-white"
                              : "text-texter-text-dim"
                          )}
                        >
                          {sslDays !== null && sslDays !== undefined ? `${sslDays} días` : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Footer de tarjeta: Hora del último chequeo e incidentes */}
                    <div className="pt-2 border-t border-texter-border/50 flex flex-col gap-1.5 text-[11px] text-texter-text-muted">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 font-mono text-[10px]">
                          <Clock className="w-3 h-3 text-texter-text-dim" />
                          <span>{formatDateTime(check?.checked_at)}</span>
                        </span>
                      </div>

                      {c.unresolved_incidents > 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 font-medium text-[11px]">
                          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                          <span>{c.unresolved_incidents} incidente(s) sin resolver</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sección: Incidentes Recientes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-texter-rose" />
              <span>Incidentes Recientes (Últimos 20)</span>
            </h3>
            <span className="text-[11px] font-mono text-texter-text-dim">
              Tabla: incident_log
            </span>
          </div>

          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {incidents.length === 0 ? (
              <div className="p-8 text-center text-xs text-texter-text-muted space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="font-semibold text-white">Sin incidentes registrados</p>
                <p className="text-texter-text-dim">Todos los chequeos de salud se encuentran en estado normal.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-texter-surface-subtle border-b border-texter-border text-texter-text-muted font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Hora</th>
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-4">Título</th>
                      <th className="py-3 px-4">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/50 font-mono">
                    {incidents.map((inc) => {
                      let kindBadge = "bg-slate-800 text-slate-300 border-slate-700";
                      if (inc.kind === "health_down") {
                        kindBadge = "bg-rose-500/10 text-rose-400 border-rose-500/30";
                      } else if (inc.kind === "health_recovered") {
                        kindBadge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                      } else if (inc.kind.includes("security") || inc.kind.includes("alert")) {
                        kindBadge = "bg-amber-500/10 text-amber-400 border-amber-500/30";
                      }

                      const detailString =
                        typeof inc.detail === "object"
                          ? JSON.stringify(inc.detail)
                          : String(inc.detail || "");

                      return (
                        <tr key={inc.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                          <td className="py-3 px-4 text-texter-text-muted whitespace-nowrap text-[11px]">
                            {formatDateTime(inc.created_at)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">
                            {inc.client_name}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={cn("px-2 py-0.5 rounded border text-[10px]", kindBadge)}>
                              {inc.kind}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-white font-sans text-xs">
                            {inc.title}
                          </td>
                          <td className="py-3 px-4 text-texter-text-dim text-[11px] truncate max-w-xs" title={detailString}>
                            {detailString || "—"}
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
      </div>
    </DashboardShell>
  );
}
