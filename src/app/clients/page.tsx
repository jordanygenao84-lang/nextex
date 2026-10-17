"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import {
  Users,
  Building2,
  Globe,
  ExternalLink,
  Plus,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Edit3,
  Eye,
  Pause,
  Play,
  Briefcase,
  Workflow,
  Bot,
  Mail,
  Phone,
  Clock,
  ShieldCheck,
} from "lucide-react";

interface Client {
  id: string;
  display_name: string;
  website_url: string | null;
  status: "active" | "inactive";
  credit_limit_monthly: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  workspace?: {
    id: string;
    name: string;
  } | null;
}

interface ClientDetailData {
  client: Client;
  workspace?: { id: string; name: string; slug?: string; owner_id?: string };
  counts: {
    automations: number;
    jobs: number;
    agents: number;
  };
}

export default function ClientsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Estados principales
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Notificaciones globales
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Verificación Web
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; status?: number; error?: string }>>({});
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({});

  // Modal Crear
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [creditLimitMonthly, setCreditLimitMonthly] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Modal Detalle
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientDetail, setClientDetail] = useState<ClientDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Modal Editar
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editWebsiteUrl, setEditWebsiteUrl] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editCreditLimitMonthly, setEditCreditLimitMonthly] = useState<string>("");
  const [editNotes, setEditNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Modal Eliminar
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal Pausar / Reanudar
  const [statusToggleClient, setStatusToggleClient] = useState<Client | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Protección de ruta
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/clients");
    }
  }, [user, isAuthLoading, router]);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadClients();
    }
  }, [user, loadClients]);

  const loadClientDetail = async (clientId: string) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClientDetail(data);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleOpenDetail = (client: Client) => {
    setSelectedClient(client);
    loadClientDetail(client.id);
  };

  // 1. Crear Cliente
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!displayName.trim()) {
      setCreateError("El nombre del negocio es obligatorio.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          website_url: websiteUrl.trim() || undefined,
          contact_name: contactName.trim() || undefined,
          contact_email: contactEmail.trim() || undefined,
          contact_phone: contactPhone.trim() || undefined,
          credit_limit_monthly: creditLimitMonthly ? Number(creditLimitMonthly) : null,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setCreateError(data?.error?.message || "Error al registrar el cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${displayName.trim()}" creado exitosamente.` });
      setIsCreateOpen(false);
      setDisplayName("");
      setWebsiteUrl("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setCreditLimitMonthly("");
      setNotes("");
      loadClients();
    } catch (err: any) {
      setCreateError(err?.message || "Ocurrió un error inesperado al registrar el cliente.");
    } finally {
      setIsCreating(false);
    }
  };

  // 2. Verificar Web
  const handleVerifyWebsite = async (client: Client) => {
    if (!client.website_url) return;

    setVerifyingIds((prev) => ({ ...prev, [client.id]: true }));
    try {
      const res = await fetch(`/api/clients/${client.id}/verify`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setVerifyResults((prev) => ({
          ...prev,
          [client.id]: { ok: true, status: data.status || 200 },
        }));
      } else {
        setVerifyResults((prev) => ({
          ...prev,
          [client.id]: { ok: false, error: data.error || "No respondió" },
        }));
      }
    } catch (err: any) {
      setVerifyResults((prev) => ({
        ...prev,
        [client.id]: { ok: false, error: err?.message || "Error de red" },
      }));
    } finally {
      setVerifyingIds((prev) => ({ ...prev, [client.id]: false }));
      setTimeout(() => {
        setVerifyResults((prev) => {
          const next = { ...prev };
          delete next[client.id];
          return next;
        });
      }, 7000);
    }
  };

  // 3. Editar Cliente
  const handleOpenEdit = (client: Client) => {
    setEditingClient(client);
    setEditDisplayName(client.display_name || "");
    setEditWebsiteUrl(client.website_url || "");
    setEditContactName(client.contact_name || "");
    setEditContactEmail(client.contact_email || "");
    setEditContactPhone(client.contact_phone || "");
    setEditCreditLimitMonthly(client.credit_limit_monthly != null ? String(client.credit_limit_monthly) : "");
    setEditNotes(client.notes || "");
    setUpdateError(null);
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    setUpdateError(null);

    if (!editDisplayName.trim()) {
      setUpdateError("El nombre del negocio no puede estar vacío.");
      return;
    }

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/clients/${editingClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDisplayName.trim(),
          website_url: editWebsiteUrl.trim() || null,
          contact_name: editContactName.trim() || null,
          contact_email: editContactEmail.trim() || null,
          contact_phone: editContactPhone.trim() || null,
          credit_limit_monthly: editCreditLimitMonthly ? Number(editCreditLimitMonthly) : null,
          notes: editNotes.trim() || null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUpdateError(data?.error?.message || "Error al actualizar los datos del cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${editDisplayName.trim()}" actualizado correctamente.` });
      setEditingClient(null);

      if (selectedClient && selectedClient.id === editingClient.id) {
        setSelectedClient(data);
        loadClientDetail(data.id);
      }

      loadClients();
    } catch (err: any) {
      setUpdateError(err?.message || "Ocurrió un error inesperado al actualizar.");
    } finally {
      setIsUpdating(false);
    }
  };

  // 4. Pausar / Reanudar Cliente
  const handleToggleStatus = async () => {
    if (!statusToggleClient) return;
    const nextStatus = statusToggleClient.status === "active" ? "inactive" : "active";

    setIsTogglingStatus(true);
    try {
      const res = await fetch(`/api/clients/${statusToggleClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "No se pudo cambiar el estado del cliente." });
      } else {
        setFeedback({
          type: "success",
          message: `Cliente "${statusToggleClient.display_name}" ${nextStatus === "active" ? "reanudado (activo)" : "pausado (inactivo)"}.`,
        });

        if (selectedClient && selectedClient.id === statusToggleClient.id) {
          setSelectedClient(data);
          if (clientDetail) {
            setClientDetail({ ...clientDetail, client: data });
          }
        }
        loadClients();
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error al cambiar estado." });
    } finally {
      setIsTogglingStatus(false);
      setStatusToggleClient(null);
    }
  };

  // 5. Eliminar Cliente
  const handleConfirmDelete = async () => {
    if (!deletingClient) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/clients/${deletingClient.id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 || data?.error?.code === "ACTIVE_RUNS_EXIST") {
        setDeleteError("tiene ejecuciones activas");
        return;
      }

      if (!res.ok) {
        setDeleteError(data?.error?.message || "Error al eliminar el cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${deletingClient.display_name}" eliminado correctamente.` });
      if (selectedClient && selectedClient.id === deletingClient.id) {
        setSelectedClient(null);
        setClientDetail(null);
      }
      setDeletingClient(null);
      loadClients();
    } catch (err: any) {
      setDeleteError(err?.message || "Error inesperado al intentar eliminar el cliente.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Contadores
  const activeCount = clients.filter((c) => c.status === "active").length;
  const inactiveCount = clients.filter((c) => c.status === "inactive").length;

  return (
    <DashboardShell
      title="Gestión de Clientes"
      subtitle="Administración de cuentas de clientes, workspaces dedicados y verificación web"
    >
      <div className="space-y-6">
        {/* ENCABEZADO CON CONTADORES */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-texter-border pb-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="p-3.5 rounded-2xl bg-texter-surface border border-texter-border flex items-center gap-3 min-w-[140px]">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <div>
                <p className="text-[11px] font-mono text-texter-text-muted uppercase tracking-wider">Activos</p>
                <p className="text-xl font-bold font-mono text-white">{activeCount}</p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-texter-surface border border-texter-border flex items-center gap-3 min-w-[140px]">
              <span className="w-2.5 h-2.5 rounded-full bg-texter-text-dim" />
              <div>
                <p className="text-[11px] font-mono text-texter-text-muted uppercase tracking-wider">Inactivos</p>
                <p className="text-xl font-bold font-mono text-white">{inactiveCount}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadClients} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>Refrescar</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setIsCreateOpen(true);
                setCreateError(null);
              }}
              className="flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo cliente</span>
            </Button>
          </div>
        </div>

        {/* Notificaciones globales */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <span className="flex items-center gap-2 font-mono">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              )}
              {feedback.message}
            </span>
            <button onClick={() => setFeedback(null)} className="text-texter-text-dim hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* TABLA DE CLIENTES */}
        <Card variant="elevated" className="space-y-4">
          <div className="flex items-center gap-2.5 border-b border-texter-border pb-3">
            <Building2 className="w-5 h-5 text-texter-cyan" />
            <div>
              <h2 className="text-base font-bold text-white">Directorio de Clientes</h2>
              <p className="text-xs text-texter-text-muted">
                Cuentas registradas con aislamiento de datos y cuotas de consumo
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                <tr>
                  <th className="p-3">Negocio</th>
                  <th className="p-3">Web</th>
                  <th className="p-3">Contacto</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Límite mensual</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50">
                {clients.map((client) => {
                  const verifyInfo = verifyResults[client.id];
                  const isVerifyingThis = verifyingIds[client.id];

                  return (
                    <tr key={client.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="p-3">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-texter-indigo" />
                          <span>{client.display_name}</span>
                        </div>
                        {client.workspace?.name && (
                          <span className="text-[10px] text-texter-text-dim font-mono">
                            WS: {client.workspace.name}
                          </span>
                        )}
                      </td>

                      <td className="p-3 font-mono">
                        {client.website_url ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={client.website_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-texter-cyan hover:underline flex items-center gap-1 truncate max-w-[200px]"
                              title={client.website_url}
                            >
                              <span>{client.website_url.replace(/^https?:\/\//, "")}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                            {verifyInfo && (
                              verifyInfo.ok ? (
                                <Badge variant="success" size="sm" className="text-[10px] whitespace-nowrap">
                                  ✓ Web OK ({verifyInfo.status || 200})
                                </Badge>
                              ) : (
                                <Badge variant="danger" size="sm" className="text-[10px] whitespace-nowrap" title={verifyInfo.error}>
                                  ✗ Error: {verifyInfo.error?.slice(0, 20)}...
                                </Badge>
                              )
                            )}
                          </div>
                        ) : (
                          <span className="text-texter-text-dim">—</span>
                        )}
                      </td>

                      <td className="p-3 text-texter-text-muted">
                        <div>{client.contact_name || client.contact_email || "—"}</div>
                        {client.contact_phone && (
                          <div className="text-[10px] font-mono text-texter-text-dim">
                            {client.contact_phone}
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        {client.status === "active" ? (
                          <Badge variant="success" size="sm" dot>Activo</Badge>
                        ) : (
                          <Badge variant="default" size="sm" dot>Inactivo</Badge>
                        )}
                      </td>

                      <td className="p-3 font-mono text-texter-text-secondary">
                        {client.credit_limit_monthly != null ? (
                          <span>{client.credit_limit_monthly.toLocaleString()} créditos</span>
                        ) : (
                          <span className="text-texter-text-dim">Sin límite</span>
                        )}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenDetail(client)}
                            className="text-[11px] h-7 px-2.5"
                          >
                            <Eye className="w-3 h-3 text-texter-cyan mr-1" />
                            Ver
                          </Button>

                          {client.website_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleVerifyWebsite(client)}
                              disabled={isVerifyingThis}
                              className="text-[11px] h-7 px-2 text-texter-text-secondary hover:text-white"
                              title="Verificar disponibilidad web"
                            >
                              <Globe className={`w-3 h-3 ${isVerifyingThis ? "animate-spin text-texter-cyan" : ""}`} />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeletingClient(client);
                              setDeleteError(null);
                            }}
                            className="text-[11px] h-7 px-2 text-texter-text-dim hover:text-rose-400"
                            title="Eliminar cliente"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {clients.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-texter-text-dim">
                      No hay clientes registrados en este sistema. Haz clic en "Nuevo cliente" para crear uno.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* DETALLE DEL CLIENTE */}
        {selectedClient && (
          <Card variant="elevated" className="space-y-5 border-texter-indigo/40 bg-texter-surface">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-texter-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{selectedClient.display_name}</h3>
                  {selectedClient.status === "active" ? (
                    <Badge variant="success" size="sm" dot>Activo</Badge>
                  ) : (
                    <Badge variant="default" size="sm" dot>Inactivo</Badge>
                  )}
                </div>
                <p className="text-xs font-mono text-texter-text-muted mt-1">
                  ID: {selectedClient.id} • Creado: {new Date(selectedClient.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit(selectedClient)}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Edit3 className="w-3.5 h-3.5 text-texter-cyan" />
                  Editar
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatusToggleClient(selectedClient)}
                  className="flex items-center gap-1.5 text-xs"
                >
                  {selectedClient.status === "active" ? (
                    <>
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                      <span>Pausar</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Reanudar</span>
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedClient(null);
                    setClientDetail(null);
                  }}
                >
                  Cerrar
                </Button>
              </div>
            </div>

            {/* Conteos de Recursos Vinculados */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-texter-text-muted uppercase font-mono">Automatizaciones</span>
                  <p className="text-xl font-bold font-mono text-texter-cyan mt-1">
                    {isLoadingDetail ? "..." : clientDetail?.counts?.automations ?? 0}
                  </p>
                </div>
                <Workflow className="w-6 h-6 text-texter-cyan/40" />
              </div>

              <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-texter-text-muted uppercase font-mono">Trabajos (Jobs)</span>
                  <p className="text-xl font-bold font-mono text-texter-indigo mt-1">
                    {isLoadingDetail ? "..." : clientDetail?.counts?.jobs ?? 0}
                  </p>
                </div>
                <Briefcase className="w-6 h-6 text-texter-indigo/40" />
              </div>

              <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-texter-text-muted uppercase font-mono">Agentes Autónomos</span>
                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {isLoadingDetail ? "..." : clientDetail?.counts?.agents ?? 0}
                  </p>
                </div>
                <Bot className="w-6 h-6 text-emerald-400/40" />
              </div>
            </div>

            {/* Datos Completos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs">
              <div className="space-y-1">
                <span className="text-texter-text-dim font-mono">Sitio Web:</span>
                <p className="text-white font-mono break-all">
                  {selectedClient.website_url ? (
                    <a
                      href={selectedClient.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-texter-cyan hover:underline inline-flex items-center gap-1"
                    >
                      {selectedClient.website_url}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    "No configurado"
                  )}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-texter-text-dim font-mono">Contacto:</span>
                <p className="text-white">{selectedClient.contact_name || "—"}</p>
                {selectedClient.contact_email && (
                  <p className="text-texter-text-muted font-mono">{selectedClient.contact_email}</p>
                )}
                {selectedClient.contact_phone && (
                  <p className="text-texter-text-muted font-mono">{selectedClient.contact_phone}</p>
                )}
              </div>

              <div className="space-y-1">
                <span className="text-texter-text-dim font-mono">Límite de Créditos:</span>
                <p className="text-white font-mono">
                  {selectedClient.credit_limit_monthly != null
                    ? `${selectedClient.credit_limit_monthly.toLocaleString()} / mes`
                    : "Sin límite mensual"}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-texter-text-dim font-mono">Workspace Vinculado:</span>
                <p className="text-white font-mono truncate">
                  {clientDetail?.workspace?.name || selectedClient.workspace?.name || "Workspace Dedicado"}
                </p>
              </div>

              {selectedClient.notes && (
                <div className="col-span-full pt-2 border-t border-texter-border space-y-1">
                  <span className="text-texter-text-dim font-mono">Notas del Cliente:</span>
                  <p className="text-texter-text-secondary leading-relaxed bg-texter-surface p-2.5 rounded-lg border border-texter-border">
                    {selectedClient.notes}
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* MODAL: NUEVO CLIENTE */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-lg w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Registrar Nuevo Cliente</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateClient} className="space-y-3.5">
              <Input
                label="Nombre del Negocio *"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="ej: Farmacia San Rafael o Distribuidora Quisqueya"
                required
              />

              <Input
                label="URL de su Web"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://..."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Nombre de Contacto"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="ej: Lic. Carlos Gómez"
                />

                <Input
                  label="Email de Contacto"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contacto@empresa.com"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Teléfono"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+18095550199"
                />

                <Input
                  label="Límite Mensual de Créditos"
                  type="number"
                  min={0}
                  value={creditLimitMonthly}
                  onChange={(e) => setCreditLimitMonthly(e.target.value)}
                  placeholder="Opcional (ej: 50000)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Notas Adicionales</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Observaciones de facturación o acuerdos comerciales..."
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isCreating}>
                  Crear Cliente
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: EDITAR CLIENTE */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-lg w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Editar Datos del Cliente</h3>
              </div>
              <button
                onClick={() => setEditingClient(null)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {updateError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{updateError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateClient} className="space-y-3.5">
              <Input
                label="Nombre del Negocio *"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                required
              />

              <Input
                label="URL de su Web"
                value={editWebsiteUrl}
                onChange={(e) => setEditWebsiteUrl(e.target.value)}
                placeholder="https://..."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Nombre de Contacto"
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />

                <Input
                  label="Email de Contacto"
                  type="email"
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Teléfono"
                  value={editContactPhone}
                  onChange={(e) => setEditContactPhone(e.target.value)}
                />

                <Input
                  label="Límite Mensual de Créditos"
                  type="number"
                  min={0}
                  value={editCreditLimitMonthly}
                  onChange={(e) => setEditCreditLimitMonthly(e.target.value)}
                  placeholder="Dejar vacío para ilimitado"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Notas Adicionales</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingClient(null)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isUpdating}>
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR PAUSAR / REANUDAR */}
      {statusToggleClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center gap-2.5 text-white font-bold text-base">
              {statusToggleClient.status === "active" ? (
                <>
                  <Pause className="w-5 h-5 text-amber-400" />
                  <span>Pausar Cliente</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 text-emerald-400" />
                  <span>Reanudar Cliente</span>
                </>
              )}
            </div>

            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas marcar como{" "}
              <strong className="text-white">
                {statusToggleClient.status === "active" ? "Inactivo" : "Activo"}
              </strong>{" "}
              al cliente <strong className="text-white">"{statusToggleClient.display_name}"</strong>?
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setStatusToggleClient(null)}>
                Volver
              </Button>
              <Button
                variant={statusToggleClient.status === "active" ? "outline" : "primary"}
                size="sm"
                onClick={handleToggleStatus}
                isLoading={isTogglingStatus}
              >
                {statusToggleClient.status === "active" ? "Confirmar Pausa" : "Confirmar Activación"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINAR CLIENTE */}
      {deletingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              <span>Eliminar Cliente</span>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2 font-mono">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas eliminar permanentemente al cliente{" "}
              <strong className="text-white">"{deletingClient.display_name}"</strong> y su espacio de trabajo? Esta acción no se puede deshacer.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-texter-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeletingClient(null);
                  setDeleteError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDelete}
                isLoading={isDeleting}
              >
                Confirmar Eliminación
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}
