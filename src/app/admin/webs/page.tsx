"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import {
  Globe,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Clock,
  KeyRound,
  Plus,
} from "lucide-react";

interface WebSummary {
  health_status: string;
  health_response_ms: number | null;
  health_checked_at: string | null;
  domains_count: number;
  dns_worst: string;
  backup_status: string;
  backup_last_at: string | null;
  backup_last_size_bytes: number | null;
  open_tickets: number;
  tickets_total: number;
  active_keys: number;
  last_activity_at: string | null;
}

interface WebItem {
  id: string;
  display_name: string;
  website_url: string | null;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  summary: WebSummary;
}

interface WebDetail {
  web: WebItem;
  domains: any[];
  backup: { config: any | null; runs: any[] };
  site_keys: any[];
  tickets: { open: number; recent: any[] };
  tracking: {
    health: any | null;
    vigia_event: any | null;
    error: any | null;
    metric: any | null;
  };
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function AdminWebsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [webs, setWebs] = useState<WebItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WebDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [showRegister, setShowRegister] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  // Carga de lista: NO depende del detalle seleccionado (lección de /admin/soporte:
  // un loader que depende del objeto que él mismo recrea entra en bucle).
  const loadWebs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/webs", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login?redirect=/admin/webs");
        return;
      }
      if (res.status === 403) {
        setIsForbidden(true);
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "No se pudieron cargar las webs.");
      }
      setWebs(json.webs || []);
    } catch (err: any) {
      setError(err?.message || "Error al cargar webs.");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  const loadWebDetail = async (webId: string) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/webs/${webId}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.web) {
        setSelected(json as WebDetail);
      }
    } catch {
      // Silencioso
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading) {
      if (!user) {
        router.push("/login?redirect=/admin/webs");
      } else {
        loadWebs();
      }
    }
  }, [user, isAuthLoading, router, loadWebs]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setIsRegistering(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: formName.trim(),
          website_url: formUrl.trim() || null,
          contact_name: formContact.trim() || null,
          contact_email: formEmail.trim() || null,
          notes: formNotes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: json?.error?.message || "No se pudo registrar la web.",
        });
        return;
      }
      setFormName("");
      setFormUrl("");
      setFormContact("");
      setFormEmail("");
      setFormNotes("");
      setShowRegister(false);
      await loadWebs();
      setFeedback({ type: "success", message: "Web registrada correctamente." });
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error al registrar la web.",
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const healthBadge = (status: string) => {
    switch (status) {
      case "ok":
        return (
          <Badge variant="success" size="sm" dot>
            Salud OK
          </Badge>
        );
      case "degraded":
        return (
          <Badge variant="warning" size="sm" dot>
            Degradada
          </Badge>
        );
      case "down":
        return (
          <Badge variant="danger" size="sm" dot>
            Caída
          </Badge>
        );
      default:
        return <Badge variant="default" size="sm">Sin datos</Badge>;
    }
  };

  const backupBadge = (status: string) => {
    switch (status) {
      case "al_dia":
        return (
          <Badge variant="success" size="sm" dot>
            Backup al día
          </Badge>
        );
      case "atrasado":
        return (
          <Badge variant="warning" size="sm" dot>
            Backup atrasado
          </Badge>
        );
      case "fallo":
        return (
          <Badge variant="danger" size="sm" dot>
            Backup falló
          </Badge>
        );
      case "pausado":
        return <Badge variant="default" size="sm">Backup pausado</Badge>;
      case "sin_corridas":
        return <Badge variant="default" size="sm">Sin corridas</Badge>;
      default:
        return <Badge variant="default" size="sm">Sin backup</Badge>;
    }
  };

  const dnsBadge = (status: string) => {
    switch (status) {
      case "ok":
        return (
          <Badge variant="success" size="sm" dot>
            DNS OK
          </Badge>
        );
      case "expiring":
        return (
          <Badge variant="warning" size="sm" dot>
            Por vencer
          </Badge>
        );
      case "dns_issue":
        return (
          <Badge variant="danger" size="sm" dot>
            Problema DNS
          </Badge>
        );
      case "expired":
        return (
          <Badge variant="danger" size="sm" dot>
            Vencido
          </Badge>
        );
      case "none":
        return <Badge variant="default" size="sm">Sin dominios</Badge>;
      default:
        return <Badge variant="default" size="sm">DNS sin revisar</Badge>;
    }
  };

  const filtered = webs.filter((w) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      w.display_name.toLowerCase().includes(q) ||
      (w.website_url || "").toLowerCase().includes(q)
    );
  });

  if (isForbidden) {
    return (
      <DashboardShell>
        <div className="max-w-lg mx-auto my-20">
          <Card
            variant="elevated"
            className="text-center py-10 px-6 space-y-4 border-texter-rose/40"
          >
            <div className="w-12 h-12 rounded-2xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">Acceso Restringido</h2>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              El apartado de Webs es exclusivo para superadministradores de la
              plataforma NEXTEХ.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard")}
              >
                Volver al Dashboard
              </Button>
            </div>
          </Card>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <AdminNav />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
              <Globe className="w-6 h-6 text-texter-cyan" />
              <span>Webs</span>
            </h1>
            <p className="text-xs sm:text-sm text-texter-text-muted mt-1">
              Registro de tus webs con su soporte, seguimiento, dominios y
              backups en una sola ficha por web.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadWebs}
              disabled={isLoading}
              className="flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
              <span>Actualizar</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowRegister((v) => !v)}
              className="flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Registrar web</span>
            </Button>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Cerrar
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {showRegister && (
          <Card variant="elevated" className="p-4">
            <form onSubmit={handleRegister} className="space-y-3">
              <h2 className="text-sm font-bold text-white">
                Registrar una web
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                    Nombre *
                  </label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    placeholder="Ej: Infinite Smells"
                    className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                    URL
                  </label>
                  <input
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                    Contacto
                  </label>
                  <input
                    value={formContact}
                    onChange={(e) => setFormContact(e.target.value)}
                    placeholder="Nombre del contacto"
                    className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                    Email de contacto
                  </label>
                  <input
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                  Notas
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="Notas internas sobre esta web..."
                  className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={isRegistering}
                >
                  Guardar web
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card variant="elevated" className="p-4">
          <div className="flex items-center justify-between gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar web por nombre o URL..."
              className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
            />
            <span className="text-xs font-mono text-texter-text-muted shrink-0">
              Total: <strong className="text-white ml-1">{webs.length}</strong>
            </span>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card variant="elevated" className="lg:col-span-5 space-y-3 p-4">
            <h2 className="text-sm font-bold text-white border-b border-texter-border pb-2.5">
              Mis webs
            </h2>

            <div className="divide-y divide-texter-border/60 max-h-[600px] overflow-y-auto">
              {filtered.map((w) => {
                const isSelected = selected?.web.id === w.id;
                return (
                  <div
                    key={w.id}
                    onClick={() => loadWebDetail(w.id)}
                    className={`p-3 cursor-pointer transition-colors rounded-lg ${
                      isSelected
                        ? "bg-texter-indigo/15 border border-indigo-500/40"
                        : "hover:bg-texter-surface-hover"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-white line-clamp-1">
                        {w.display_name}
                      </p>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {healthBadge(w.summary.health_status)}
                        {backupBadge(w.summary.backup_status)}
                      </div>
                    </div>

                    <p className="text-[11px] text-texter-cyan truncate mt-1">
                      {w.website_url || "Sin URL registrada"}
                    </p>

                    <div className="flex items-center justify-between mt-2 text-[11px] text-texter-text-muted">
                      <span>
                        {w.summary.domains_count} dominio(s) ·{" "}
                        {w.summary.open_tickets} ticket(s) abierto(s) ·{" "}
                        {w.summary.active_keys} llave(s) activa(s)
                      </span>
                      <span className="font-mono flex items-center gap-1 text-[10px]">
                        <Clock className="w-3 h-3" />
                        {w.summary.last_activity_at
                          ? formatDate(w.summary.last_activity_at)
                          : "Sin actividad"}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && !isLoading && (
                <div className="py-10 text-center text-xs text-texter-text-dim">
                  No hay webs con ese filtro. Registra la primera arriba.
                </div>
              )}

              {isLoading && (
                <div className="py-10 text-center text-xs text-texter-text-dim">
                  Cargando webs...
                </div>
              )}
            </div>
          </Card>

          <Card
            variant="elevated"
            className="lg:col-span-7 p-4 flex flex-col min-h-[480px]"
          >
            {!selected ? (
              <div className="my-auto text-center py-16 text-xs text-texter-text-dim">
                Selecciona una web de la lista para ver su soporte, seguimiento,
                dominios y backups.
              </div>
            ) : isLoadingDetail ? (
              <div className="my-auto text-center py-16 text-xs text-texter-text-dim">
                Cargando ficha de la web...
              </div>
            ) : (
              <div className="space-y-6">
                <div className="border-b border-texter-border pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white">
                      {selected.web.display_name}
                    </h3>
                    {healthBadge(
                      selected.tracking.health?.status || "sin_datos"
                    )}
                  </div>
                  <p className="text-xs text-texter-text-muted mt-1">
                    {selected.web.website_url ? (
                      <a
                        href={selected.web.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-texter-cyan underline"
                      >
                        {selected.web.website_url}
                      </a>
                    ) : (
                      "Sin URL registrada"
                    )}
                    {" · "}
                    Contacto:{" "}
                    {selected.web.contact_name || selected.web.contact_email || "—"}
                    {" · "}
                    Registrada: {formatDate(selected.web.created_at)}
                  </p>
                  {selected.web.notes && (
                    <p className="text-xs text-white mt-2 whitespace-pre-wrap">
                      {selected.web.notes}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white mb-2">
                    APIs de seguimiento
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
                      <span className="font-mono text-texter-text-muted">
                        Salud VIGÍA
                      </span>
                      <span className="text-white text-right">
                        {selected.tracking.health
                          ? `${selected.tracking.health.status} · ${selected.tracking.health.response_ms ?? "—"} ms · ${formatDate(selected.tracking.health.checked_at)}`
                          : "Sin chequeos todavía"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
                      <span className="font-mono text-texter-text-muted">
                        POST /api/vigia/events
                      </span>
                      <span className="text-white text-right">
                        {selected.tracking.vigia_event
                          ? `${selected.tracking.vigia_event.event_type} · ${formatDate(selected.tracking.vigia_event.created_at)}`
                          : "Sin eventos reportados"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
                      <span className="font-mono text-texter-text-muted">
                        POST /api/errors/report
                      </span>
                      <span className="text-white text-right">
                        {selected.tracking.error
                          ? `Último error: ${formatDate(selected.tracking.error.last_seen_at)}`
                          : "Sin errores reportados"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
                      <span className="font-mono text-texter-text-muted">
                        POST /api/analytics/report
                      </span>
                      <span className="text-white text-right">
                        {selected.tracking.metric
                          ? `${selected.tracking.metric.metric} · ${selected.tracking.metric.metric_date}`
                          : "Sin métricas reportadas"}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-white">Dominios</h4>
                    <Link
                      href="/admin/dominios"
                      className="text-[11px] text-texter-cyan underline"
                    >
                      Gestionar dominios
                    </Link>
                  </div>
                  {selected.domains.length === 0 ? (
                    <p className="text-xs text-texter-text-dim">
                      Esta web no tiene dominios registrados.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selected.domains.map((d: any) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs"
                        >
                          <div>
                            <p className="font-bold text-white">{d.domain}</p>
                            <p className="text-texter-text-muted text-[11px]">
                              {d.registrar || "Registrador no indicado"} · Vence:{" "}
                              {d.expires_at || "—"}
                            </p>
                          </div>
                          {dnsBadge(d.dns_status)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-white">Backups</h4>
                    <Link
                      href="/admin/proteccion"
                      className="text-[11px] text-texter-cyan underline"
                    >
                      Gestionar backups
                    </Link>
                  </div>
                  {!selected.backup.config ? (
                    <p className="text-xs text-texter-text-dim">
                      Esta web no tiene backup configurado.
                    </p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <p className="text-texter-text-muted">
                        Repo:{" "}
                        <span className="text-white font-mono">
                          {selected.backup.config.github_repo || "—"}
                        </span>{" "}
                        ({selected.backup.config.github_branch}) ·{" "}
                        {selected.backup.config.enabled ? "Activo" : "Pausado"}
                      </p>
                      {selected.backup.runs.length === 0 ? (
                        <p className="text-texter-text-dim">
                          Sin corridas todavía.
                        </p>
                      ) : (
                        selected.backup.runs.map((r: any) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border"
                          >
                            <span className="text-white">
                              {r.kind} · {r.status}
                            </span>
                            <span className="text-texter-text-muted">
                              {formatBytes(r.size_bytes)} · {formatDate(r.created_at)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-white">
                      Soporte ({selected.tickets.open} abierto(s))
                    </h4>
                    <Link
                      href="/admin/soporte"
                      className="text-[11px] text-texter-cyan underline"
                    >
                      Ir a Soporte
                    </Link>
                  </div>
                  {selected.tickets.recent.length === 0 ? (
                    <p className="text-xs text-texter-text-dim">
                      Sin tickets para esta web.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selected.tickets.recent.map((t: any) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs"
                        >
                          <span className="font-bold text-white line-clamp-1">
                            {t.subject}
                          </span>
                          <span className="text-texter-text-muted shrink-0">
                            {t.status} · {formatDate(t.updated_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-texter-cyan" />
                    Llaves de sitio
                  </h4>
                  {selected.site_keys.length === 0 ? (
                    <p className="text-xs text-texter-text-dim">
                      Sin llaves de sitio. Se crean desde el flujo de conexiones
                      del cliente.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selected.site_keys.map((k: any) => (
                        <div
                          key={k.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs"
                        >
                          <span className="text-white">
                            {k.name}{" "}
                            <span className="font-mono text-texter-text-muted">
                              ({k.key_prefix}…)
                            </span>
                          </span>
                          <span className="text-texter-text-muted shrink-0">
                            {k.is_active ? "Activa" : "Revocada"} · Último uso:{" "}
                            {formatDate(k.last_used_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-texter-text-dim mt-2">
                    Por seguridad, aquí solo se muestra el prefijo de cada
                    llave, nunca su valor.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
