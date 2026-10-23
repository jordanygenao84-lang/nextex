"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Plus,
  RefreshCw,
  Lock,
  ArrowRight,
  Loader2,
  Trash2,
  Edit2,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Calendar,
  MapPin,
  Building2,
  X,
  FileText,
  Clock,
  Bug,
  Activity,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Settings,
  Play,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { CredentialRecord, CredentialStatus } from "@/lib/protection/credentials";
import type { ErrorEventRecord, ErrorSummary } from "@/lib/protection/errors";

interface ClientOption {
  id: string;
  display_name: string;
}

const PROVIDERS = [
  { value: "github", label: "GitHub" },
  { value: "vercel", label: "Vercel" },
  { value: "supabase", label: "Supabase" },
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
  { value: "openai", label: "OpenAI" },
  { value: "otro", label: "Otro" },
] as const;

export default function ProteccionPage() {
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados para Errores de las webs (NIV1-4)
  const [errors, setErrors] = useState<ErrorEventRecord[]>([]);
  const [errorSummary, setErrorSummary] = useState<ErrorSummary>({
    total_groups: 0,
    occurrences_24h: 0,
  });
  const [expandedErrorId, setExpandedErrorId] = useState<Record<string, boolean>>({});

  // Estados para Respaldos (NIV1-5)
  const [backupClients, setBackupClients] = useState<any[]>([]);
  const [backupRecentRuns, setBackupRecentRuns] = useState<any[]>([]);
  const [runningBackupClientId, setRunningBackupClientId] = useState<string | null>(null);
  const [expandedRunDetailId, setExpandedRunDetailId] = useState<Record<string, boolean>>({});

  // Modal de Configuración de Respaldo
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configClientId, setConfigClientId] = useState("");
  const [configClientName, setConfigClientName] = useState("");
  const [configSupabaseUrl, setConfigSupabaseUrl] = useState("");
  const [configServiceKey, setConfigServiceKey] = useState("");
  const [configGithubRepo, setConfigGithubRepo] = useState("");
  const [configGithubBranch, setConfigGithubBranch] = useState("main");
  const [configGithubToken, setConfigGithubToken] = useState("");
  const [configEnabled, setConfigEnabled] = useState(true);
  const [hasExistingServiceKey, setHasExistingServiceKey] = useState(false);
  const [hasExistingGithubToken, setHasExistingGithubToken] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Modal de Crear / Editar
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Campos del formulario
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState<string>("github");
  const [formClientId, setFormClientId] = useState<string>("");
  const [formLocation, setFormLocation] = useState("");
  const [formExpiresAt, setFormExpiresAt] = useState("");
  const [formAlertDays, setFormAlertDays] = useState<number>(7);
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
      console.warn("No se pudieron cargar clientes para el selector:", err);
    }
  }, []);

  const fetchCredentials = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await fetch("/api/admin/credentials");

      if (res.status === 401 || res.status === 403) {
        setIsSuperAdmin(false);
        return false;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Error al cargar credenciales.");
      }

      const data = await res.json();
      setCredentials(data.credentials || []);
      setIsSuperAdmin(true);
      return true;
    } catch (err: any) {
      console.error("Error al cargar la bóveda de credenciales:", err);
      setErrorMsg(err?.message || "Error al sincronizar con la bóveda de credenciales.");
      return false;
    }
  }, []);

  const fetchErrors = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/errors");
      if (!res.ok) return;
      const data = await res.json();
      setErrors(data.errors || []);
      if (data.summary) {
        setErrorSummary(data.summary);
      }
    } catch (err) {
      console.error("Error al cargar registro de errores:", err);
    }
  }, []);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/backups");
      if (!res.ok) return;
      const data = await res.json();
      setBackupClients(data.clients || []);
      setBackupRecentRuns(data.recent_runs || []);
    } catch (err) {
      console.error("Error al cargar estado de respaldos:", err);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const ok = await fetchCredentials();
      if (ok) {
        await Promise.all([fetchClients(), fetchErrors(), fetchBackups()]);
      }
      setLoading(false);
    }
    init();
  }, [fetchCredentials, fetchClients, fetchErrors, fetchBackups]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchCredentials(), fetchClients(), fetchErrors(), fetchBackups()]);
    setRefreshing(false);
  };

  const handleToggleDetail = (id: string) => {
    setExpandedErrorId((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleToggleRunDetail = (id: string) => {
    setExpandedRunDetailId((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const formatSizeBytes = (bytes?: number | null) => {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return "—";
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleOpenConfigModal = (clientItem: any) => {
    setConfigClientId(clientItem.id);
    setConfigClientName(clientItem.display_name);
    const cfg = clientItem.config;
    setConfigSupabaseUrl(cfg?.supabase_url || "");
    setConfigServiceKey("");
    setConfigGithubRepo(cfg?.github_repo || "");
    setConfigGithubBranch(cfg?.github_branch || "main");
    setConfigGithubToken("");
    setConfigEnabled(cfg ? Boolean(cfg.enabled) : true);
    setHasExistingServiceKey(Boolean(cfg?.has_service_key));
    setHasExistingGithubToken(Boolean(cfg?.has_github_token));
    setConfigError(null);
    setIsConfigModalOpen(true);
  };

  const handleCloseConfigModal = () => {
    if (isSavingConfig) return;
    setIsConfigModalOpen(false);
    setConfigError(null);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigError(null);
    setIsSavingConfig(true);
    try {
      const payload: any = {
        client_id: configClientId,
        supabase_url: configSupabaseUrl.trim() || null,
        github_repo: configGithubRepo.trim() || null,
        github_branch: configGithubBranch.trim() || "main",
        enabled: configEnabled,
      };
      if (configServiceKey.trim()) {
        payload.service_key = configServiceKey.trim();
      }
      if (configGithubToken.trim()) {
        payload.github_token = configGithubToken.trim();
      }
      const res = await fetch("/api/admin/backups/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Error al guardar configuración");
      }
      setIsConfigModalOpen(false);
      await fetchBackups();
    } catch (err: any) {
      setConfigError(err?.message || "Error al guardar configuración de respaldo.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleRunBackup = async (clientId: string) => {
    setRunningBackupClientId(clientId);
    try {
      const res = await fetch("/api/admin/backups/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || "Error al disparar el respaldo.");
      }
      await fetchBackups();
    } catch (err: any) {
      alert(err?.message || "No se pudo ejecutar el respaldo.");
    } finally {
      setRunningBackupClientId(null);
    }
  };

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString) return "Nunca";
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      if (diffMs < 0) return "Ahora mismo";
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return "hace un momento";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `hace ${diffMin} min`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `hace ${diffHours} h`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return "hace 1 día";
      return `hace ${diffDays} días`;
    } catch {
      return isoString;
    }
  };

  const handleOpenCreate = () => {
    setModalMode("create");
    setEditingId(null);
    setFormName("");
    setFormProvider("github");
    setFormClientId("");
    setFormLocation("");
    setFormExpiresAt("");
    setFormAlertDays(7);
    setFormNotes("");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (cred: CredentialRecord) => {
    setModalMode("edit");
    setEditingId(cred.id);
    setFormName(cred.name || "");
    setFormProvider(cred.provider || "github");
    setFormClientId(cred.client_id || "");
    setFormLocation(cred.location || "");
    setFormExpiresAt(cred.expires_at || "");
    setFormAlertDays(
      typeof cred.alert_days_before === "number" && !isNaN(cred.alert_days_before)
        ? cred.alert_days_before
        : 7
    );
    setFormNotes(cred.notes || "");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    setFormError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError("El nombre de la credencial es obligatorio.");
      return;
    }

    if (!formProvider) {
      setFormError("Debes seleccionar un proveedor.");
      return;
    }

    let parsedExpiresAt: string | null = null;
    if (formExpiresAt.trim()) {
      const trimmedDate = formExpiresAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        setFormError("La fecha de vencimiento debe tener formato YYYY-MM-DD.");
        return;
      }
      parsedExpiresAt = trimmedDate;
    }

    setIsSaving(true);

    try {
      const payload = {
        name: trimmedName,
        provider: formProvider,
        client_id: formClientId.trim() ? formClientId.trim() : null,
        location: formLocation.trim() ? formLocation.trim() : null,
        expires_at: parsedExpiresAt,
        alert_days_before: Math.max(0, Number(formAlertDays) || 7),
        notes: formNotes.trim() ? formNotes.trim() : null,
      };

      const url =
        modalMode === "create"
          ? "/api/admin/credentials"
          : `/api/admin/credentials/${editingId}`;

      const method = modalMode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "No se pudo guardar la credencial.");
      }

      setIsModalOpen(false);
      await fetchCredentials();
    } catch (err: any) {
      setFormError(err?.message || "Error al procesar la solicitud.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (cred: CredentialRecord) => {
    const confirmed = window.confirm(
      `¿Estás seguro de que deseas eliminar la credencial "${cred.name}"?\nEsta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    setDeletingId(cred.id);
    try {
      const res = await fetch(`/api/admin/credentials/${cred.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Error al eliminar credencial.");
      }

      await fetchCredentials();
    } catch (err: any) {
      alert(err?.message || "No se pudo eliminar la credencial.");
    } finally {
      setDeletingId(null);
    }
  };

  // Contadores para resumen
  const stats = {
    total: credentials.length,
    expired: credentials.filter((c) => c.status === "expired").length,
    warning: credentials.filter((c) => c.status === "warning").length,
    ok: credentials.filter((c) => c.status === "ok").length,
    no_expiry: credentials.filter((c) => c.status === "no_expiry").length,
  };

  if (loading) {
    return (
      <DashboardShell
        title="Protección — Bóveda & Resiliencia"
        subtitle="Inventario de credenciales, control de vencimientos y monitoreo de infraestructura"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Accediendo a la bóveda de protección...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="Protección — Bóveda & Resiliencia"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-texter-surface border border-texter-border text-center space-y-4 shadow-texter-card">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de NEXTEХ. Tu usuario no posee permisos para consultar la bóveda de protección.
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

  const renderStatusBadge = (status?: CredentialStatus, daysLeft?: number | null) => {
    if (status === "expired") {
      const days = daysLeft !== null && daysLeft !== undefined ? Math.abs(daysLeft) : 0;
      const text = days === 0 ? "Vence hoy" : `VENCIDA hace ${days} ${days === 1 ? "día" : "días"}`;
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          {text}
        </span>
      );
    }

    if (status === "warning") {
      const days = daysLeft ?? 0;
      const text = days === 0 ? "vence hoy" : `vence en ${days} ${days === 1 ? "día" : "días"}`;
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {text}
        </span>
      );
    }

    if (status === "ok") {
      const days = daysLeft ?? 0;
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {days} {days === 1 ? "día" : "días"}
        </span>
      );
    }

    // no_expiry
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        sin vencimiento
      </span>
    );
  };

  const getProviderBadge = (provider: string) => {
    const prov = String(provider).toLowerCase();
    const map: Record<string, { label: string; style: string }> = {
      github: { label: "GitHub", style: "bg-slate-800 text-white border-slate-700" },
      vercel: { label: "Vercel", style: "bg-black text-slate-200 border-slate-800" },
      supabase: { label: "Supabase", style: "bg-emerald-950/60 text-emerald-400 border-emerald-800/50" },
      meta: { label: "Meta", style: "bg-blue-950/60 text-blue-400 border-blue-800/50" },
      google: { label: "Google", style: "bg-indigo-950/60 text-indigo-300 border-indigo-800/50" },
      openai: { label: "OpenAI", style: "bg-teal-950/60 text-teal-300 border-teal-800/50" },
      otro: { label: "Otro", style: "bg-slate-800/60 text-slate-400 border-slate-700" },
    };

    const config = map[prov] || { label: provider, style: "bg-slate-800 text-slate-300 border-slate-700" };

    return (
      <span className={cn("px-2 py-0.5 rounded text-[11px] font-mono border uppercase tracking-wider", config.style)}>
        {config.label}
      </span>
    );
  };

  return (
    <DashboardShell
      title="Protección — Bóveda & Resiliencia"
      subtitle="Inventario de credenciales, control de vencimientos y monitoreo de infraestructura"
    >
      <AdminNav />

      <div className="space-y-6">
        {/* Aviso de seguridad obligatorio */}
        <div className="p-4 rounded-2xl bg-texter-amber/10 border border-texter-amber/30 text-amber-300 text-xs flex items-center gap-3 shadow-sm">
          <ShieldAlert className="w-5 h-5 shrink-0 text-texter-amber" />
          <span className="font-medium leading-relaxed">
            Solo se guardan datos de referencia. Nunca escribas aquí el valor de una clave o contraseña.
          </span>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center justify-between gap-2">
            <span>{errorMsg}</span>
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              Reintentar
            </Button>
          </div>
        )}

        {/* Resumen / Tarjetas de Estado */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">Total</span>
              <KeyRound className="w-4 h-4 text-texter-indigo" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">{stats.total}</div>
            <p className="text-[10px] text-texter-text-muted">Credenciales registradas</p>
          </div>

          <div
            className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              stats.expired > 0 ? "border-rose-500/50 bg-rose-500/5" : "border-texter-border"
            )}
          >
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-rose-400">Vencidas</span>
              <XCircle className="w-4 h-4 text-texter-rose" />
            </div>
            <div className="text-2xl font-bold text-rose-400 font-mono">{stats.expired}</div>
            <p className="text-[10px] text-texter-text-muted">Requieren rotación</p>
          </div>

          <div
            className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              stats.warning > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-texter-border"
            )}
          >
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-amber-400">Por vencer</span>
              <AlertTriangle className="w-4 h-4 text-texter-amber" />
            </div>
            <div className="text-2xl font-bold text-amber-400 font-mono">{stats.warning}</div>
            <p className="text-[10px] text-texter-text-muted">Dentro del umbral de alerta</p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-emerald-400">Al día</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">{stats.ok}</div>
            <p className="text-[10px] text-texter-text-muted">Vigencia saludable</p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-slate-400">Sin vencimiento</span>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-bold text-slate-300 font-mono">{stats.no_expiry}</div>
            <p className="text-[10px] text-texter-text-muted">Sin fecha límite fijada</p>
          </div>
        </div>

        {/* Sección: Credenciales */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-texter-indigo" />
                <span>🔑 Credenciales</span>
                <Badge variant="indigo" size="sm">
                  {credentials.length}
                </Badge>
              </h3>
              <p className="text-xs text-texter-text-muted">
                Control y alerta temprana de tokens de API, llaves SSH y accesos de plataforma o satélites.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="px-3 py-2 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-texter-text-secondary hover:text-white text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
                title="Recargar credenciales"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
                <span>{refreshing ? "Sincronizando..." : "Actualizar"}</span>
              </button>

              <button
                onClick={handleOpenCreate}
                className="px-3.5 py-2 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-texter-glow-indigo"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva credencial</span>
              </button>
            </div>
          </div>

          {/* Tabla de Credenciales */}
          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {credentials.length === 0 ? (
              <div className="p-12 text-center text-xs text-texter-text-muted space-y-3">
                <KeyRound className="w-10 h-10 text-texter-indigo mx-auto opacity-70" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">No hay credenciales en la bóveda</p>
                  <p className="text-texter-text-dim max-w-sm mx-auto">
                    Registra tokens de GitHub, llaves de Vercel, proyectos de Supabase o credenciales de clientes para monitorear sus vencimientos.
                  </p>
                </div>
                <div className="pt-2">
                  <Button size="sm" variant="primary" onClick={handleOpenCreate} leftIcon={<Plus className="w-3.5 h-3.5" />}>
                    Registrar primera credencial
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                      <th className="py-3 px-4 font-semibold">Nombre & Proveedor</th>
                      <th className="py-3 px-4 font-semibold">Cliente</th>
                      <th className="py-3 px-4 font-semibold">Dónde vive (Location)</th>
                      <th className="py-3 px-4 font-semibold">Vencimiento</th>
                      <th className="py-3 px-4 font-semibold">Estado</th>
                      <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/40">
                    {credentials.map((cred) => {
                      const isDeleting = deletingId === cred.id;

                      return (
                        <tr
                          key={cred.id}
                          className="hover:bg-texter-surface-hover/30 transition-colors group"
                        >
                          {/* Nombre & Proveedor */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm tracking-tight">
                                  {cred.name}
                                </span>
                                {getProviderBadge(cred.provider)}
                              </div>
                              {cred.notes && (
                                <p className="text-[11px] text-texter-text-dim max-w-xs truncate" title={cred.notes}>
                                  {cred.notes}
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Cliente */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {cred.client_id && cred.client ? (
                              <div className="flex items-center gap-1.5 text-white font-medium">
                                <Building2 className="w-3.5 h-3.5 text-texter-cyan shrink-0" />
                                <span>{cred.client.display_name}</span>
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                                Plataforma
                              </span>
                            )}
                          </td>

                          {/* Dónde vive */}
                          <td className="py-3.5 px-4">
                            {cred.location ? (
                              <div className="flex items-center gap-1.5 text-texter-text-secondary font-mono text-xs max-w-xs truncate" title={cred.location}>
                                <MapPin className="w-3.5 h-3.5 text-texter-text-dim shrink-0" />
                                <span className="truncate">{cred.location}</span>
                              </div>
                            ) : (
                              <span className="text-texter-text-dim italic">No especificado</span>
                            )}
                          </td>

                          {/* Vencimiento */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {cred.expires_at ? (
                              <div className="flex items-center gap-1.5 font-mono text-xs text-white">
                                <Calendar className="w-3.5 h-3.5 text-texter-text-dim shrink-0" />
                                <span>{cred.expires_at}</span>
                              </div>
                            ) : (
                              <span className="text-texter-text-dim">Sin vencimiento</span>
                            )}
                          </td>

                          {/* Estado / Badge */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {renderStatusBadge(cred.status, cred.days_left)}
                          </td>

                          {/* Acciones */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenEdit(cred)}
                                className="p-1.5 rounded-lg bg-texter-surface-subtle hover:bg-texter-surface-hover text-texter-text-muted hover:text-white border border-texter-border transition-colors"
                                title="Editar credencial"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleDelete(cred)}
                                disabled={isDeleting}
                                className="p-1.5 rounded-lg bg-texter-rose/10 hover:bg-texter-rose/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 transition-colors disabled:opacity-50"
                                title="Eliminar credencial"
                              >
                                {isDeleting ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
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

        {/* Sección: Errores de las webs (NIV1-4) */}
        <div className="space-y-4 pt-6 border-t border-texter-border">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Bug className="w-4 h-4 text-texter-rose" />
              <span>🐞 Errores de las webs</span>
              <Badge variant="danger" size="sm">
                {errorSummary.total_groups}
              </Badge>
            </h3>
            <p className="text-xs text-texter-text-muted">
              Registro centralizado de excepciones y fallos agrupados por fingerprint, reportados en vivo por las webs satélite.
            </p>
          </div>

          {/* Contadores arriba: grupos totales y ocurrencias en 24h */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium">Grupos Totales</span>
                <Bug className="w-4 h-4 text-texter-rose" />
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {errorSummary.total_groups}
              </div>
              <p className="text-[10px] text-texter-text-muted">Tipos de error únicos agrupados</p>
            </div>

            <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
              <div className="flex items-center justify-between text-texter-text-muted">
                <span className="text-xs font-medium text-amber-400">Ocurrencias (24h)</span>
                <Activity className="w-4 h-4 text-texter-amber" />
              </div>
              <div className="text-2xl font-bold text-amber-400 font-mono">
                {errorSummary.occurrences_24h}
              </div>
              <p className="text-[10px] text-texter-text-muted">Impacto acumulado en el último día</p>
            </div>
          </div>

          {/* Lista de Errores */}
          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {errors.length === 0 ? (
              <div className="p-12 text-center text-xs text-texter-text-muted space-y-2">
                <div className="text-3xl mb-1">🎉</div>
                <p className="text-sm font-semibold text-white">Sin errores reportados 🎉</p>
                <p className="text-texter-text-dim max-w-sm mx-auto">
                  Las webs satélite están operando con normalidad y no han reportado fallos recientemente.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-texter-border/40">
                {errors.map((err) => {
                  const isExpanded = Boolean(expandedErrorId[err.id]);
                  return (
                    <div
                      key={err.id}
                      className="p-4 sm:p-5 hover:bg-texter-surface-hover/30 transition-colors space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-texter-surface-subtle border border-texter-border text-white font-semibold">
                              {err.client?.display_name || "Cliente desconocido"}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                              {err.error_type || "general"}
                            </span>
                            <Badge variant="danger" size="sm">
                              {err.occurrences} {err.occurrences === 1 ? "ocurrencia" : "ocurrencias"}
                            </Badge>
                            <span className="text-[11px] font-mono text-texter-text-muted flex items-center gap-1">
                              <Clock className="w-3 h-3 text-texter-text-dim" />
                              {formatRelativeTime(err.last_seen_at)}
                            </span>
                          </div>

                          <p className="text-xs text-texter-text-primary font-mono leading-relaxed break-words">
                            {err.message}
                          </p>
                        </div>

                        {/* Botón Ver Detalle */}
                        <div className="shrink-0 flex items-center">
                          <button
                            onClick={() => handleToggleDetail(err.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-[11px] text-texter-text-secondary hover:text-white flex items-center gap-1.5 transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                            <span>{isExpanded ? "Ocultar detalle" : "Ver detalle"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Desplegable JSON detail */}
                      {isExpanded && (
                        <div className="p-3.5 rounded-xl bg-black/60 border border-texter-border/50 text-[11px] font-mono space-y-2 animate-fade-in">
                          <div className="flex items-center justify-between text-texter-text-muted">
                            <span className="text-[10px] uppercase tracking-wider text-texter-text-dim">
                              Detalle técnico (detail):
                            </span>
                            <span className="text-[10px] text-texter-text-dim font-mono">
                              Fingerprint: {err.fingerprint.slice(0, 16)}...
                            </span>
                          </div>
                          <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap max-h-64 scrollbar-thin">
                            {JSON.stringify(err.detail || {}, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sección: Respaldos (NIV1-5) */}
        <div className="space-y-4 pt-6 border-t border-texter-border">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-texter-cyan" />
              <span>💾 Respaldos</span>
              <Badge variant="cyan" size="sm">
                Motor v1.18
              </Badge>
            </h3>
            <p className="text-xs text-texter-text-muted">
              Motor central de copias de seguridad de BD Supabase y repositorios GitHub hacia almacenamiento protegido.
            </p>
          </div>

          {/* Texto fijo obligatorio */}
          <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-texter-text-secondary flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-texter-cyan shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Las llaves se guardan cifradas y nunca se muestran. Este respaldo es una copia de seguridad: la restauración se hace con el kit de relanzamiento del proyecto.
            </p>
          </div>

          {/* Tarjetas / Tabla por cliente */}
          <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            <div className="p-4 border-b border-texter-border/80 bg-texter-surface-subtle/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Satélites & Proyectos ({backupClients.length})
              </span>
              <span className="text-[11px] text-texter-text-dim font-mono">
                Cadencia automática: cada 6 días vía tick
              </span>
            </div>

            {backupClients.length === 0 ? (
              <div className="p-8 text-center text-xs text-texter-text-muted">
                No hay clientes registrados en la plataforma.
              </div>
            ) : (
              <div className="divide-y divide-texter-border/40">
                {backupClients.map((item) => {
                  const cfg = item.config;
                  const isConfigured = Boolean(cfg);
                  const isEnabled = Boolean(cfg?.enabled);
                  const latest = item.latest_run;
                  const isRunning = runningBackupClientId === item.id;

                  let statusBadge = (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                      Sin respaldos aún
                    </span>
                  );
                  if (latest?.status === "ok") {
                    statusBadge = (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        OK
                      </span>
                    );
                  } else if (latest?.status === "partial") {
                    statusBadge = (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Parcial
                      </span>
                    );
                  } else if (latest?.status === "failed") {
                    statusBadge = (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                        Fallido
                      </span>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className="p-4 sm:p-5 hover:bg-texter-surface-hover/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <strong className="text-sm font-bold text-white tracking-tight">
                            {item.display_name}
                          </strong>
                          {isConfigured ? (
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider",
                                isEnabled
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-slate-800 text-slate-400 border-slate-700"
                              )}
                            >
                              {isEnabled ? "Activo" : "Pausado"}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              Sin configurar
                            </span>
                          )}
                          {statusBadge}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-texter-text-muted flex-wrap font-mono">
                          {latest ? (
                            <>
                              <span>Último: <strong className="text-white">{formatRelativeTime(latest.created_at)}</strong></span>
                              <span>•</span>
                              <span>Tamaño: <strong className="text-white">{formatSizeBytes(latest.size_bytes)}</strong></span>
                              {latest.location && (
                                <>
                                  <span>•</span>
                                  <span className="truncate max-w-xs text-texter-text-dim" title={latest.location}>
                                    {latest.location}
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="text-texter-text-dim italic">Nunca se ha ejecutado un respaldo para este cliente</span>
                          )}
                        </div>

                        {cfg && (
                          <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-texter-text-dim flex-wrap">
                            {cfg.supabase_url && (
                              <span className="px-1.5 py-0.5 rounded bg-black/40 border border-texter-border/50">
                                DB: {cfg.supabase_url.replace(/^https?:\/\//, "")}
                              </span>
                            )}
                            {cfg.github_repo && (
                              <span className="px-1.5 py-0.5 rounded bg-black/40 border border-texter-border/50">
                                Repo: {cfg.github_repo}@{cfg.github_branch || "main"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Botones de acción */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenConfigModal(item)}
                          className="px-3 py-1.5 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-xs text-white font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <Settings className="w-3.5 h-3.5 text-texter-text-muted" />
                          <span>Configurar</span>
                        </button>

                        <button
                          onClick={() => handleRunBackup(item.id)}
                          disabled={isRunning || !isConfigured}
                          className="px-3 py-1.5 rounded-xl bg-texter-indigo hover:bg-texter-indigo-hover text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-texter-glow-indigo disabled:opacity-50 disabled:cursor-not-allowed"
                          title={!isConfigured ? "Debes configurar el respaldo primero" : "Ejecutar respaldo inmediato"}
                        >
                          {isRunning ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                          <span>{isRunning ? "Respaldando..." : "Respaldar ahora"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historial de corridas desde backup_runs */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-texter-indigo" />
              <span>Historial de Corridas Recientes ({backupRecentRuns.length})</span>
            </h4>

            <div className="rounded-2xl bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
              {backupRecentRuns.length === 0 ? (
                <div className="p-8 text-center text-xs text-texter-text-muted">
                  No hay corridas de respaldo registradas en el historial.
                </div>
              ) : (
                <div className="divide-y divide-texter-border/40 text-xs">
                  {backupRecentRuns.map((run) => {
                    const isExpanded = Boolean(expandedRunDetailId[run.id]);

                    let badge = (
                      <Badge variant="cyan" size="sm">
                        {run.status}
                      </Badge>
                    );
                    if (run.status === "ok") badge = <Badge variant="success" size="sm">OK</Badge>;
                    else if (run.status === "partial") badge = <Badge variant="warning" size="sm">Parcial</Badge>;
                    else if (run.status === "failed") badge = <Badge variant="danger" size="sm">Fallido</Badge>;

                    return (
                      <div key={run.id} className="p-3.5 sm:p-4 hover:bg-texter-surface-hover/30 transition-colors space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <strong className="text-white font-semibold">
                              {run.client?.display_name || "Cliente"}
                            </strong>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                              {run.kind}
                            </span>
                            {badge}
                            <span className="font-mono text-texter-text-dim text-[11px]">
                              {formatRelativeTime(run.created_at)}
                            </span>
                            <span className="text-texter-text-muted font-mono text-[11px]">
                              • {formatSizeBytes(run.size_bytes)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleRunDetail(run.id)}
                              className="px-2 py-1 rounded-lg bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-[11px] text-texter-text-secondary hover:text-white flex items-center gap-1 transition-colors"
                            >
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              <span>{isExpanded ? "Ocultar" : "Detalles"}</span>
                            </button>
                          </div>
                        </div>

                        {run.location && (
                          <div className="text-[11px] font-mono text-texter-text-dim truncate">
                            Destino: {run.location}
                          </div>
                        )}

                        {isExpanded && (
                          <div className="p-3 rounded-xl bg-black/60 border border-texter-border/50 text-[11px] font-mono space-y-2 animate-fade-in">
                            <div className="flex justify-between text-texter-text-dim text-[10px] uppercase">
                              <span>Detalle de corrida (detail):</span>
                              <span>ID: {run.id}</span>
                            </div>
                            <pre className="text-cyan-300 overflow-x-auto whitespace-pre-wrap max-h-48 scrollbar-thin">
                              {JSON.stringify(run.detail || {}, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Crear / Editar Credencial */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Cabecera del modal */}
            <div className="p-5 border-b border-texter-border flex items-center justify-between bg-texter-surface-subtle/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-texter-indigo/15 border border-indigo-500/30 flex items-center justify-center text-texter-indigo">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {modalMode === "create" ? "Nueva Credencial" : "Editar Credencial"}
                  </h3>
                  <p className="text-[11px] text-texter-text-muted">
                    Bóveda de metadatos de protección
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

            {/* Formulario */}
            <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0 text-texter-rose" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Nombre */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Nombre de la credencial <span className="text-texter-rose">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ej. GitHub Personal Token (jjj)"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Proveedor y Cliente */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Proveedor <span className="text-texter-rose">*</span>
                  </label>
                  <select
                    value={formProvider}
                    onChange={(e) => setFormProvider(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

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
              </div>

              {/* Dónde vive */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Dónde vive (location)
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="ej. Vercel > Environment Variables, GitHub > Secrets"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Fecha de vencimiento y Días de anticipación para alerta */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Fecha de vencimiento (opcional)
                  </label>
                  <input
                    type="date"
                    value={formExpiresAt}
                    onChange={(e) => setFormExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                  <p className="text-[10px] text-texter-text-dim">Dejar vacío si no vence</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Alertar días antes (Telegram)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={formAlertDays}
                    onChange={(e) => setFormAlertDays(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                  <p className="text-[10px] text-texter-text-dim">Por defecto 7 días antes</p>
                </div>
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Notas de referencia (opcional)
                </label>
                <textarea
                  rows={3}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="ej. Permisos scopes: repo, workflow. Renovar en github.com/settings/tokens."
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors resize-none"
                />
              </div>

              <div className="p-3 rounded-xl bg-texter-surface-subtle/80 border border-texter-border/50 text-[11px] text-texter-text-dim">
                Recordatorio de seguridad: Esta bóveda almacena exclusivamente metadatos. Ningún secreto ni contraseña debe ser ingresado.
              </div>

              {/* Botones de acción del modal */}
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
                  {modalMode === "create" ? "Guardar credencial" : "Actualizar credencial"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Configuración de Respaldo (NIV1-5) */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-texter-border flex items-center justify-between bg-texter-surface-subtle/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-texter-cyan/15 border border-cyan-500/30 flex items-center justify-center text-texter-cyan">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Configurar Respaldo: {configClientName}
                  </h3>
                  <p className="text-[11px] text-texter-text-muted">
                    Parámetros de conexión para BD y repositorio
                  </p>
                </div>
              </div>

              <button
                onClick={handleCloseConfigModal}
                disabled={isSavingConfig}
                className="p-1.5 text-texter-text-muted hover:text-white rounded-lg hover:bg-texter-surface-hover transition-colors"
                aria-label="Cerrar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-5 space-y-4 overflow-y-auto flex-1">
              {configError && (
                <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0 text-texter-rose" />
                  <span>{configError}</span>
                </div>
              )}

              {/* Supabase URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  URL del Proyecto Supabase
                </label>
                <input
                  type="url"
                  value={configSupabaseUrl}
                  onChange={(e) => setConfigSupabaseUrl(e.target.value)}
                  placeholder="https://xxxxxxxx.supabase.co"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Service Key */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white block">
                    Service Role Key (Supabase)
                  </label>
                  {hasExistingServiceKey && (
                    <span className="text-[10px] font-mono text-emerald-400">
                      ✓ Clave configurada
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={configServiceKey}
                  onChange={(e) => setConfigServiceKey(e.target.value)}
                  placeholder={hasExistingServiceKey ? "•••••••••••••••• (dejar vacío para mantener)" : "eyJh..."}
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* GitHub Repo y Rama */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Repositorio GitHub (owner/repo)
                  </label>
                  <input
                    type="text"
                    value={configGithubRepo}
                    onChange={(e) => setConfigGithubRepo(e.target.value)}
                    placeholder="jordanygenao84-lang/satelite"
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Rama
                  </label>
                  <input
                    type="text"
                    value={configGithubBranch}
                    onChange={(e) => setConfigGithubBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>
              </div>

              {/* GitHub Token */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white block">
                    Token de Acceso GitHub (opcional si es repo público)
                  </label>
                  {hasExistingGithubToken && (
                    <span className="text-[10px] font-mono text-emerald-400">
                      ✓ Token configurado
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={configGithubToken}
                  onChange={(e) => setConfigGithubToken(e.target.value)}
                  placeholder={hasExistingGithubToken ? "•••••••••••••••• (dejar vacío para mantener)" : "ghp_..."}
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Enabled Checkbox */}
              <div className="pt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="backup-enabled-checkbox"
                  checked={configEnabled}
                  onChange={(e) => setConfigEnabled(e.target.checked)}
                  className="rounded border-texter-border bg-texter-surface-subtle text-texter-indigo focus:ring-0"
                />
                <label htmlFor="backup-enabled-checkbox" className="text-xs text-white font-medium cursor-pointer">
                  Habilitar respaldo automático programado (cada 6 días)
                </label>
              </div>

              <div className="p-3 rounded-xl bg-texter-surface-subtle/80 border border-texter-border/50 text-[11px] text-texter-text-dim">
                Las llaves se guardan cifradas con AES-256-GCM y nunca se muestran en pantalla ni se registran en logs.
              </div>

              {/* Botones de acción */}
              <div className="pt-3 border-t border-texter-border flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCloseConfigModal}
                  disabled={isSavingConfig}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSavingConfig}
                >
                  Guardar configuración
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
