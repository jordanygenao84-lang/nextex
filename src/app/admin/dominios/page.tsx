"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  Globe,
  Plus,
  RefreshCw,
  Lock,
  ArrowRight,
  Loader2,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Building2,
  Calendar,
  X,
  SearchCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { DomainRecord, DomainDnsStatus } from "@/lib/domains/check";

interface ClientOption {
  id: string;
  display_name: string;
}

const DOMAIN_PROVIDERS = [
  { value: "vercel", label: "Vercel" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "otro", label: "Otro" },
] as const;

export default function AdminDominiosPage() {
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Confirmación en dos clics dentro de la página (no window.confirm: los
  // diálogos nativos se descartan solos en navegadores gestionados y el
  // borrado parecía no hacer nada).
  const [deleteDomConfirmId, setDeleteDomConfirmId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal Crear / Editar Dominio
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Campos del formulario
  const [formDomain, setFormDomain] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formProvider, setFormProvider] = useState("vercel");
  const [formRegistrar, setFormRegistrar] = useState("");
  const [formExpiresAt, setFormExpiresAt] = useState("");
  const [formAutoRenew, setFormAutoRenew] = useState(false);
  const [formExpectedTarget, setFormExpectedTarget] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setClients(
            data.map((c: any) => ({
              id: c.id,
              display_name: c.display_name,
            }))
          );
        }
      }
    } catch (err) {
      console.warn("No se pudieron cargar clientes:", err);
    }
  }, []);

  const fetchDomains = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch("/api/admin/domains");

      if (res.status === 401 || res.status === 403) {
        setIsSuperAdmin(false);
        return false;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "Error al cargar inventario de dominios."
        );
      }

      const data = await res.json();
      setDomains(data.domains || []);
      setIsSuperAdmin(true);
      return true;
    } catch (err: any) {
      console.error("Error cargando dominios:", err);
      setErrorMsg(
        err?.message || "Error al sincronizar el inventario de dominios."
      );
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const ok = await fetchDomains();
      if (ok) {
        await fetchClients();
      }
      setLoading(false);
    }
    init();
  }, [fetchDomains, fetchClients]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDomains(), fetchClients()]);
    setRefreshing(false);
  };

  const handleOpenCreate = () => {
    setModalMode("create");
    setEditingId(null);
    setFormDomain("");
    setFormClientId("");
    setFormProvider("vercel");
    setFormRegistrar("");
    setFormExpiresAt("");
    setFormAutoRenew(false);
    setFormExpectedTarget("");
    setFormNotes("");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (dom: DomainRecord) => {
    setModalMode("edit");
    setEditingId(dom.id);
    setFormDomain(dom.domain || "");
    setFormClientId(dom.client_id || "");
    setFormProvider(dom.provider || "vercel");
    setFormRegistrar(dom.registrar || "");
    setFormExpiresAt(dom.expires_at ? String(dom.expires_at).slice(0, 10) : "");
    setFormAutoRenew(Boolean(dom.auto_renew));
    setFormExpectedTarget(dom.expected_target || "");
    setFormNotes(dom.notes || "");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    setFormError(null);
  };

  const handleSaveDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formDomain.trim()) {
      setFormError("El nombre de dominio es obligatorio.");
      return;
    }

    if (
      formExpiresAt.trim() !== "" &&
      !/^\d{4}-\d{2}-\d{2}$/.test(formExpiresAt.trim())
    ) {
      setFormError("La fecha de vencimiento debe tener formato YYYY-MM-DD.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        domain: formDomain.trim(),
        client_id: formClientId.trim() || null,
        provider: formProvider || null,
        registrar: formRegistrar.trim() || null,
        expires_at: formExpiresAt.trim() || null,
        auto_renew: formAutoRenew,
        expected_target: formExpectedTarget.trim() || null,
        notes: formNotes.trim() || null,
      };

      const url =
        modalMode === "create"
          ? "/api/admin/domains"
          : `/api/admin/domains/${editingId}`;
      const method = modalMode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo guardar el dominio."
        );
      }

      setIsModalOpen(false);
      await fetchDomains();
    } catch (err: any) {
      setFormError(err?.message || "Error al guardar el dominio.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckDnsNow = async (dom: DomainRecord) => {
    setCheckingId(dom.id);
    try {
      const res = await fetch(`/api/admin/domains/${dom.id}/check`, {
        method: "POST",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo verificar el DNS."
        );
      }

      await fetchDomains();
    } catch (err: any) {
      alert(err?.message || "Error al verificar el DNS del dominio.");
    } finally {
      setCheckingId(null);
    }
  };

  const handleDeleteDomain = async (dom: DomainRecord) => {
    if (deleteDomConfirmId !== dom.id) {
      setDeleteDomConfirmId(dom.id);
      return;
    }
    setDeleteDomConfirmId(null);

    setDeletingId(dom.id);
    try {
      const res = await fetch(`/api/admin/domains/${dom.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "Error al eliminar el dominio."
        );
      }

      await fetchDomains();
    } catch (err: any) {
      alert(err?.message || "No se pudo eliminar el dominio.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return "Nunca";
    try {
      return new Date(isoString).toLocaleString("es-DO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const renderStatusBadge = (
    status: DomainDnsStatus,
    daysLeft?: number | null
  ) => {
    if (status === "ok") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          ok
        </span>
      );
    }
    if (status === "dns_issue") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          dns_issue
        </span>
      );
    }
    if (status === "expiring") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          expiring
          {daysLeft !== null && daysLeft !== undefined
            ? ` (${daysLeft}d)`
            : ""}
        </span>
      );
    }
    if (status === "expired") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          expired
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        unknown
      </span>
    );
  };

  if (loading) {
    return (
      <DashboardShell
        title="Dominios — Inventario & Vigilancia DNS"
        subtitle="Control de resolución A/AAAA/CNAME, registradores y vencimientos de dominios de satélites y plataforma"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Cargando inventario de dominios y estado DNS...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="Dominios — Inventario & Vigilancia DNS"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-texter-surface border border-texter-border text-center space-y-4 shadow-texter-card">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de NEXTEХ. Tu usuario no posee permisos para gestionar el inventario de dominios.
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
      title="Dominios — Inventario & Vigilancia DNS"
      subtitle="Control de resolución A/AAAA/CNAME, registradores y vencimientos de dominios de satélites y plataforma"
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

        {/* Cabecera y botones de acción */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Globe className="w-4 h-4 text-texter-indigo" />
              <span>Inventario de Dominios y DNS</span>
              <Badge variant="indigo" size="sm">
                {domains.length}
              </Badge>
            </h3>
            <p className="text-xs text-texter-text-muted">
              Verificación activa de resolución A/AAAA/CNAME y alertas de vencimiento a 30 días.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-2 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-texter-text-secondary hover:text-white text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
              />
              <span>{refreshing ? "Sincronizando..." : "Actualizar"}</span>
            </button>

            <button
              onClick={handleOpenCreate}
              className="px-3.5 py-2 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-texter-glow-indigo"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo dominio</span>
            </button>
          </div>
        </div>

        {/* Tabla de Dominios */}
        <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
          {domains.length === 0 ? (
            <div className="p-12 text-center text-xs text-texter-text-muted space-y-3">
              <Globe className="w-10 h-10 text-texter-indigo mx-auto opacity-70" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  No hay dominios registrados
                </p>
                <p className="text-texter-text-dim max-w-sm mx-auto">
                  Registra los dominios y subdominios de tus satélites y de la plataforma para monitorear su resolución DNS y fechas de expiración.
                </p>
              </div>
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleOpenCreate}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Nuevo dominio
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                    <th className="py-3 px-4 font-semibold">Dominio</th>
                    <th className="py-3 px-4 font-semibold">Cliente</th>
                    <th className="py-3 px-4 font-semibold">Proveedor</th>
                    <th className="py-3 px-4 font-semibold">Registrador</th>
                    <th className="py-3 px-4 font-semibold">Vencimiento</th>
                    <th className="py-3 px-4 font-semibold">Estado</th>
                    <th className="py-3 px-4 font-semibold">
                      Última Revisión DNS
                    </th>
                    <th className="py-3 px-4 font-semibold text-right">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-texter-border/40">
                  {domains.map((dom) => {
                    const isChecking = checkingId === dom.id;
                    const isDeleting = deletingId === dom.id;

                    return (
                      <tr
                        key={dom.id}
                        className="hover:bg-texter-surface-hover/30 transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-white text-sm">
                              {dom.domain}
                            </span>
                            {dom.expected_target && (
                              <span className="block text-[10px] font-mono text-texter-text-dim">
                                Target: {dom.expected_target}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {dom.client_id && dom.client ? (
                            <div className="flex items-center gap-1.5 text-white font-medium">
                              <Building2 className="w-3.5 h-3.5 text-texter-cyan shrink-0" />
                              <span>{dom.client.display_name}</span>
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                              Plataforma
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono uppercase text-[11px] text-texter-text-secondary">
                          {dom.provider || "—"}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap text-texter-text-secondary">
                          {dom.registrar || "—"}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                          {dom.expires_at ? (
                            <div className="flex items-center gap-1.5 text-white">
                              <Calendar className="w-3.5 h-3.5 text-texter-text-dim shrink-0" />
                              <span>{String(dom.expires_at).slice(0, 10)}</span>
                            </div>
                          ) : (
                            <span className="text-texter-text-dim">
                              no aplica
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {renderStatusBadge(dom.dns_status, dom.days_left)}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-texter-text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-texter-text-dim" />
                            {formatDateTime(dom.dns_checked_at)}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleCheckDnsNow(dom)}
                              disabled={isChecking}
                              className="px-2.5 py-1.5 rounded-lg bg-texter-indigo/15 hover:bg-texter-indigo/25 text-indigo-300 hover:text-white border border-indigo-500/30 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                              title="Ejecutar resolución DNS en vivo"
                            >
                              {isChecking ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <SearchCheck className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {isChecking
                                  ? "Verificando..."
                                  : "Verificar DNS ahora"}
                              </span>
                            </button>

                            <button
                              onClick={() => handleOpenEdit(dom)}
                              className="p-1.5 rounded-lg bg-texter-surface-subtle hover:bg-texter-surface-hover text-texter-text-muted hover:text-white border border-texter-border transition-colors"
                              title="Editar dominio"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleDeleteDomain(dom)}
                              disabled={isDeleting}
                              className={`p-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                                deleteDomConfirmId === dom.id
                                  ? "bg-texter-rose/25 text-white border-rose-500/50 px-2.5 text-[11px] font-semibold"
                                  : "bg-texter-rose/10 hover:bg-texter-rose/20 text-rose-400 hover:text-rose-300 border-rose-500/20"
                              }`}
                              title={
                                deleteDomConfirmId === dom.id
                                  ? "Pulsa otra vez para confirmar el borrado permanente"
                                  : "Eliminar dominio"
                              }
                            >
                              {isDeleting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : deleteDomConfirmId === dom.id ? (
                                <span>¿Seguro?</span>
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
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

      {/* Modal Crear / Editar Dominio */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-texter-border flex items-center justify-between bg-texter-surface-subtle/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-texter-indigo/15 border border-indigo-500/30 flex items-center justify-center text-texter-indigo">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {modalMode === "create"
                      ? "Nuevo Dominio"
                      : "Editar Dominio"}
                  </h3>
                  <p className="text-[11px] text-texter-text-muted">
                    Inventario DNS y control de vencimiento
                  </p>
                </div>
              </div>

              <button
                onClick={handleCloseModal}
                disabled={isSaving}
                className="p-1.5 text-texter-text-muted hover:text-white rounded-lg hover:bg-texter-surface-hover transition-colors"
                aria-label="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveDomain}
              className="p-5 space-y-4 overflow-y-auto flex-1"
            >
              {formError && (
                <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0 text-texter-rose" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Dominio */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Dominio <span className="text-texter-rose">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formDomain}
                  onChange={(e) => setFormDomain(e.target.value)}
                  placeholder="ej. infinite-smells-gmss.vercel.app"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Cliente y Proveedor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Cliente asociado
                  </label>
                  <select
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    <option value="">Plataforma (sin cliente)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Proveedor DNS / Hosting
                  </label>
                  <select
                    value={formProvider}
                    onChange={(e) => setFormProvider(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    {DOMAIN_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Registrador y Fecha de Vencimiento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Registrador (opcional)
                  </label>
                  <input
                    type="text"
                    value={formRegistrar}
                    onChange={(e) => setFormRegistrar(e.target.value)}
                    placeholder="ej. Namecheap, Cloudflare, GoDaddy"
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Fecha de vencimiento (opcional)
                  </label>
                  <input
                    type="date"
                    value={formExpiresAt}
                    onChange={(e) => setFormExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>
              </div>

              {/* Target esperado (CNAME / IP) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  CNAME / IP esperado (expected_target, opcional)
                </label>
                <input
                  type="text"
                  value={formExpectedTarget}
                  onChange={(e) => setFormExpectedTarget(e.target.value)}
                  placeholder="ej. cname.vercel-dns.com o 76.76.21.21"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Auto-renew */}
              <div className="pt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="domain-autorenew-checkbox"
                  checked={formAutoRenew}
                  onChange={(e) => setFormAutoRenew(e.target.checked)}
                  className="rounded border-texter-border bg-texter-surface-subtle text-texter-indigo focus:ring-0"
                />
                <label
                  htmlFor="domain-autorenew-checkbox"
                  className="text-xs text-white font-medium cursor-pointer"
                >
                  Renovación automática activa (auto_renew)
                </label>
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Notas (opcional)
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Notas de configuración DNS o cuenta registradora..."
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors resize-none"
                />
              </div>

              <div className="pt-3 border-t border-texter-border flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCloseModal}
                  disabled={isSaving}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSaving}
                >
                  {modalMode === "create"
                    ? "Guardar dominio"
                    : "Actualizar dominio"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
