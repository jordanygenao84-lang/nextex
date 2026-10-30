"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import {
  Receipt,
  CreditCard,
  Plus,
  RefreshCw,
  Lock,
  ArrowRight,
  Loader2,
  Edit2,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Calendar,
  Building2,
  X,
  Clock,
  DollarSign,
  PauseCircle,
  PlayCircle,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type {
  SubscriptionStatus,
  SubscriptionCurrency,
} from "@/lib/billing/subscriptions";

interface ClientOption {
  id: string;
  display_name: string;
}

interface SubscriptionItem {
  id: string;
  client_id: string;
  client_name: string | null;
  plan_name: string;
  amount: number;
  currency: SubscriptionCurrency;
  billing_day: number | null;
  status: SubscriptionStatus;
  grace_days: number;
  next_invoice_date: string;
  pending_invoices_count: number;
  pending_subscription_invoices_count: number;
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

interface InvoiceItem {
  id: string;
  client_id: string;
  client_name: string | null;
  subscription_id: string | null;
  kind: "consumption" | "subscription" | string;
  period: string;
  tokens_total: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "cancelled" | string;
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

function getTodayDateInput(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function AdminFacturacionPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<InvoiceItem[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [togglingSubId, setTogglingSubId] = useState<string | null>(null);

  // Modal Crear / Editar Suscripción
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Campos del formulario
  const [formClientId, setFormClientId] = useState("");
  const [formClientName, setFormClientName] = useState("");
  const [formPlanName, setFormPlanName] = useState("");
  const [formAmount, setFormAmount] = useState<string>("50");
  const [formCurrency, setFormCurrency] = useState<SubscriptionCurrency>("USD");
  const [formBillingDay, setFormBillingDay] = useState<number>(1);
  const [formGraceDays, setFormGraceDays] = useState<number>(3);
  const [formNextInvoiceDate, setFormNextInvoiceDate] = useState<string>(
    getTodayDateInput()
  );
  const [formStatus, setFormStatus] = useState<SubscriptionStatus>("active");

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

  const fetchBillingData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [subRes, invRes] = await Promise.all([
        fetch("/api/admin/subscriptions"),
        fetch("/api/admin/invoices?status=pending"),
      ]);

      if (
        subRes.status === 401 ||
        subRes.status === 403 ||
        invRes.status === 401 ||
        invRes.status === 403
      ) {
        setIsSuperAdmin(false);
        return false;
      }

      if (!subRes.ok) {
        const errJson = await subRes.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "Error al cargar suscripciones."
        );
      }

      const subData = await subRes.json();
      const invData = invRes.ok ? await invRes.json() : { invoices: [] };

      setSubscriptions(subData.subscriptions || []);
      setPendingInvoices(invData.invoices || []);
      setIsSuperAdmin(true);
      return true;
    } catch (err: any) {
      console.error("Error cargando facturación admin:", err);
      setErrorMsg(
        err?.message || "Error al sincronizar el panel de facturación."
      );
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const ok = await fetchBillingData();
      if (ok) {
        await fetchClients();
      }
      setLoading(false);
    }
    init();
  }, [fetchBillingData, fetchClients]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchBillingData(), fetchClients()]);
    setRefreshing(false);
  };

  const handleOpenCreate = () => {
    const today = getTodayDateInput();
    const defaultDay = Math.min(Math.max(1, Number(today.split("-")[2]) || 1), 28);
    const subscribedClientIds = new Set(subscriptions.map((s) => s.client_id));
    const firstAvailableClient =
      clients.find((c) => !subscribedClientIds.has(c.id)) || clients[0];

    setModalMode("create");
    setEditingSubId(null);
    setFormClientId(firstAvailableClient?.id || "");
    setFormClientName(firstAvailableClient?.display_name || "");
    setFormPlanName("Plan Pro Mensual");
    setFormAmount("50.00");
    setFormCurrency("USD");
    setFormBillingDay(defaultDay);
    setFormGraceDays(3);
    setFormNextInvoiceDate(today);
    setFormStatus("active");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (sub: SubscriptionItem) => {
    setModalMode("edit");
    setEditingSubId(sub.id);
    setFormClientId(sub.client_id);
    setFormClientName(
      sub.client_name || sub.client?.display_name || "Cliente"
    );
    setFormPlanName(sub.plan_name);
    setFormAmount(Number(sub.amount).toFixed(2));
    setFormCurrency(sub.currency || "USD");
    setFormBillingDay(
      sub.billing_day && sub.billing_day >= 1 && sub.billing_day <= 28
        ? sub.billing_day
        : 1
    );
    setFormGraceDays(sub.grace_days ?? 3);
    setFormNextInvoiceDate(
      String(sub.next_invoice_date || getTodayDateInput()).slice(0, 10)
    );
    setFormStatus(sub.status || "active");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    setFormError(null);
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (modalMode === "create" && !formClientId.trim()) {
      setFormError("Debes seleccionar un cliente.");
      return;
    }

    if (!formPlanName.trim()) {
      setFormError("El nombre del plan es obligatorio.");
      return;
    }

    const parsedAmount = Number(formAmount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      setFormError("El monto debe ser un número válido >= 0.");
      return;
    }

    const parsedBillingDay = Number(formBillingDay);
    if (
      !Number.isInteger(parsedBillingDay) ||
      parsedBillingDay < 1 ||
      parsedBillingDay > 28
    ) {
      setFormError("El día de cobro debe estar entre 1 y 28.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(formNextInvoiceDate.trim())) {
      setFormError("La fecha del próximo cobro debe tener formato YYYY-MM-DD.");
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        plan_name: formPlanName.trim(),
        amount: parsedAmount,
        currency: formCurrency,
        billing_day: parsedBillingDay,
        grace_days: Math.max(0, Number(formGraceDays) || 0),
        next_invoice_date: formNextInvoiceDate.trim(),
        status: formStatus,
      };

      if (modalMode === "create") {
        payload.client_id = formClientId.trim();
      }

      const url =
        modalMode === "create"
          ? "/api/admin/subscriptions"
          : `/api/admin/subscriptions/${editingSubId}`;
      const method = modalMode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo guardar la suscripción."
        );
      }

      setIsModalOpen(false);
      await fetchBillingData();
    } catch (err: any) {
      setFormError(err?.message || "Error al guardar la suscripción.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    sub: SubscriptionItem,
    newStatus: SubscriptionStatus
  ) => {
    setTogglingSubId(sub.id);
    try {
      const res = await fetch(`/api/admin/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo cambiar el estado."
        );
      }

      await fetchBillingData();
    } catch (err: any) {
      alert(err?.message || "Error al cambiar el estado de la suscripción.");
    } finally {
      setTogglingSubId(null);
    }
  };

  const handleMarkInvoicePaid = async (inv: InvoiceItem) => {
    setMarkingPaidId(inv.id);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error?.message || "No se pudo marcar la factura como pagada."
        );
      }

      await fetchBillingData();
    } catch (err: any) {
      alert(err?.message || "Error al marcar la factura como pagada.");
    } finally {
      setMarkingPaidId(null);
    }
  };

  const formatAge = (isoString?: string | null) => {
    if (!isoString) return "—";
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      if (diffMs < 0) return "Hoy";
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours < 1) {
        const diffMin = Math.max(1, Math.floor(diffMs / (1000 * 60)));
        return `hace ${diffMin} min`;
      }
      if (diffHours < 24) return `hace ${diffHours} h`;
      const diffDays = Math.floor(diffHours / 24);
      return diffDays === 1 ? "hace 1 día" : `hace ${diffDays} días`;
    } catch {
      return isoString;
    }
  };

  const renderSubscriptionStatusBadge = (status: SubscriptionStatus) => {
    if (status === "active") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Activa (active)
        </span>
      );
    }
    if (status === "past_due") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          En mora (past_due)
        </span>
      );
    }
    if (status === "suspended") {
      return (
        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          Suspendida (suspended)
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        Cancelada (cancelled)
      </span>
    );
  };

  // Cálculos de resumen superior (MRR por moneda y conteos de estado)
  const mrrUsd = subscriptions
    .filter((s) => s.status === "active" && s.currency === "USD")
    .reduce((acc, s) => acc + Number(s.amount || 0), 0);

  const mrrDop = subscriptions
    .filter((s) => s.status === "active" && s.currency === "DOP")
    .reduce((acc, s) => acc + Number(s.amount || 0), 0);

  const counts = {
    active: subscriptions.filter((s) => s.status === "active").length,
    past_due: subscriptions.filter((s) => s.status === "past_due").length,
    suspended: subscriptions.filter((s) => s.status === "suspended").length,
  };

  if (loading) {
    return (
      <DashboardShell
        title="Facturación — Suscripciones & Cobro Recurrente"
        subtitle="Gestión central de planes mensuales, ciclo de mora, cortes de servicio y liquidación de facturas"
      >
        <AdminNav />
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-texter-indigo animate-spin" />
          <p className="text-xs text-texter-text-muted font-mono">
            Cargando suscripciones y estado de facturación...
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (isSuperAdmin === false) {
    return (
      <DashboardShell
        title="Acceso Restringido"
        subtitle="Facturación — Suscripciones & Cobro Recurrente"
      >
        <div className="max-w-md mx-auto my-16 p-6 rounded-2xl nextex-panel bg-texter-surface border border-texter-border text-center space-y-4 shadow-texter-card">
          <div className="w-12 h-12 rounded-xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso Denegado</h2>
          <p className="text-xs text-texter-text-muted leading-relaxed">
            Esta sección es exclusiva para superadministradores de NEXTEХ. Tu usuario no posee permisos para gestionar la facturación de la plataforma.
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
      title="Facturación — Suscripciones & Cobro Recurrente"
      subtitle="Gestión central de planes mensuales, ciclo de mora, cortes de servicio y liquidación de facturas"
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

        {/* 1. Resumen Superior: Ingreso Mensual Recurrente (USD/DOP) + Conteos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1.5">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium">
                Ingreso Mensual Recurrente (MRR)
              </span>
              <DollarSign className="w-4 h-4 text-texter-indigo" />
            </div>
            <div className="space-y-0.5 font-mono">
              <div className="text-xl font-bold text-white">
                ${mrrUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                <span className="text-xs font-normal text-texter-cyan">USD</span>
              </div>
              <div className="text-sm font-semibold text-slate-300">
                RD${mrrDop.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                <span className="text-[11px] font-normal text-texter-text-muted">DOP</span>
              </div>
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Suma de suscripciones en estado active
            </p>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-1">
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-emerald-400">
                Activas
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              {counts.active}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Servicio operativo y al día
            </p>
          </div>

          <div
            className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              counts.past_due > 0
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-texter-border"
            )}
          >
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-amber-400">
                En Mora (past_due)
              </span>
              <AlertTriangle className="w-4 h-4 text-texter-amber" />
            </div>
            <div className="text-2xl font-bold text-amber-400 font-mono">
              {counts.past_due}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Factura vencida tras días de gracia
            </p>
          </div>

          <div
            className={cn(
              "p-4 rounded-xl bg-texter-surface border space-y-1",
              counts.suspended > 0
                ? "border-rose-500/50 bg-rose-500/5"
                : "border-texter-border"
            )}
          >
            <div className="flex items-center justify-between text-texter-text-muted">
              <span className="text-xs font-medium text-rose-400">
                Suspendidas
              </span>
              <XCircle className="w-4 h-4 text-texter-rose" />
            </div>
            <div className="text-2xl font-bold text-rose-400 font-mono">
              {counts.suspended}
            </div>
            <p className="text-[10px] text-texter-text-muted">
              Widget y automatizaciones en corte
            </p>
          </div>
        </div>

        {/* 2. Sección: Suscripciones */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-texter-indigo" />
                <span>Suscripciones</span>
                <Badge variant="indigo" size="sm">
                  {subscriptions.length}
                </Badge>
              </h3>
              <p className="text-xs text-texter-text-muted">
                Planes de renta mensual fija por cliente, fechas de próximo corte y estado del servicio.
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
                <span>Nueva suscripción</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl nextex-panel bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {subscriptions.length === 0 ? (
              <div className="p-12 text-center text-xs text-texter-text-muted space-y-3">
                <CreditCard className="w-10 h-10 text-texter-indigo mx-auto opacity-70" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">
                    No hay suscripciones registradas
                  </p>
                  <p className="text-texter-text-dim max-w-sm mx-auto">
                    Crea la primera suscripción mensual para automatizar el cobro recurrente y el control de servicio de tus satélites.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleOpenCreate}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Nueva suscripción
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                      <th className="py-3 px-4 font-semibold">Cliente</th>
                      <th className="py-3 px-4 font-semibold">Plan</th>
                      <th className="py-3 px-4 font-semibold">Monto</th>
                      <th className="py-3 px-4 font-semibold">Día de Cobro</th>
                      <th className="py-3 px-4 font-semibold">Próximo Cobro</th>
                      <th className="py-3 px-4 font-semibold">Estado</th>
                      <th className="py-3 px-4 font-semibold">
                        Facturas Pendientes
                      </th>
                      <th className="py-3 px-4 font-semibold text-right">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/40">
                    {subscriptions.map((sub) => {
                      const isToggling = togglingSubId === sub.id;
                      const clientLabel =
                        sub.client_name ||
                        sub.client?.display_name ||
                        "Cliente";

                      return (
                        <tr
                          key={sub.id}
                          className="hover:bg-texter-surface-hover/30 transition-colors"
                        >
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2 font-bold text-white text-sm">
                              <Building2 className="w-3.5 h-3.5 text-texter-cyan shrink-0" />
                              <span>{clientLabel}</span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <span className="text-white font-medium">
                              {sub.plan_name}
                            </span>
                            <span className="block text-[10px] font-mono text-texter-text-dim">
                              Gracia: {sub.grace_days}d
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono font-bold text-white">
                            {Number(sub.amount).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            <span className="text-texter-cyan text-[11px]">
                              {sub.currency}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono text-texter-text-secondary">
                            Día {sub.billing_day || 1}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-mono text-white">
                              <Calendar className="w-3.5 h-3.5 text-texter-text-dim shrink-0" />
                              <span>
                                {String(sub.next_invoice_date).slice(0, 10)}
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {renderSubscriptionStatusBadge(sub.status)}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {sub.pending_invoices_count > 0 ? (
                              <Badge variant="warning" size="sm">
                                {sub.pending_invoices_count}{" "}
                                {sub.pending_invoices_count === 1
                                  ? "pendiente"
                                  : "pendientes"}
                              </Badge>
                            ) : (
                              <span className="text-texter-text-dim font-mono text-[11px]">
                                0 pendientes
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {sub.status !== "suspended" ? (
                                <button
                                  onClick={() =>
                                    handleQuickStatusChange(sub, "suspended")
                                  }
                                  disabled={isToggling}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/25 text-[11px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                                  title="Suspender servicio inmediatamente"
                                >
                                  {isToggling ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <PauseCircle className="w-3 h-3" />
                                  )}
                                  <span>Suspender</span>
                                </button>
                              ) : (
                                <button
                                  onClick={() =>
                                    handleQuickStatusChange(sub, "active")
                                  }
                                  disabled={isToggling}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 text-[11px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                                  title="Reactivar servicio manualmente"
                                >
                                  {isToggling ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <PlayCircle className="w-3 h-3" />
                                  )}
                                  <span>Reactivar</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleOpenEdit(sub)}
                                className="px-2.5 py-1.5 rounded-lg bg-texter-surface-subtle hover:bg-texter-surface-hover text-texter-text-secondary hover:text-white border border-texter-border text-[11px] font-medium flex items-center gap-1 transition-colors"
                                title="Editar suscripción"
                              >
                                <Edit2 className="w-3 h-3" />
                                <span>Editar</span>
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

        {/* 3. Sección: Facturas pendientes */}
        <div className="space-y-4 pt-6 border-t border-texter-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Receipt className="w-4 h-4 text-texter-amber" />
                <span>Facturas pendientes</span>
                <Badge variant="warning" size="sm">
                  {pendingInvoices.length}
                </Badge>
              </h3>
              <p className="text-xs text-texter-text-muted">
                Facturas en estado pending (suscripción fija y consumo de IA). Al marcar pagada, el motor reactiva automáticamente en el siguiente tick.
              </p>
            </div>
          </div>

          <div className="rounded-2xl nextex-panel bg-texter-surface border border-texter-border overflow-hidden shadow-sm">
            {pendingInvoices.length === 0 ? (
              <div className="p-12 text-center text-xs text-texter-text-muted space-y-2">
                <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto opacity-80" />
                <p className="text-sm font-semibold text-white">
                  No hay facturas pendientes de cobro
                </p>
                <p className="text-texter-text-dim max-w-sm mx-auto">
                  Todos los clientes están al día con sus facturas de suscripción y consumo.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-texter-border/80 bg-texter-surface-subtle/50 text-texter-text-dim uppercase font-mono text-[10px] tracking-wider">
                      <th className="py-3 px-4 font-semibold">Cliente</th>
                      <th className="py-3 px-4 font-semibold">Período</th>
                      <th className="py-3 px-4 font-semibold">Tipo (kind)</th>
                      <th className="py-3 px-4 font-semibold">Monto</th>
                      <th className="py-3 px-4 font-semibold">Antigüedad</th>
                      <th className="py-3 px-4 font-semibold text-right">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-texter-border/40">
                    {pendingInvoices.map((inv) => {
                      const isMarking = markingPaidId === inv.id;
                      const clientLabel =
                        inv.client_name ||
                        inv.client?.display_name ||
                        "Cliente";

                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-texter-surface-hover/30 transition-colors"
                        >
                          <td className="py-3.5 px-4 whitespace-nowrap font-semibold text-white">
                            {clientLabel}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono text-white">
                            {inv.period}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {inv.kind === "subscription" ? (
                              <Badge variant="indigo" size="sm">
                                subscription
                              </Badge>
                            ) : (
                              <Badge variant="cyan" size="sm">
                                consumption
                              </Badge>
                            )}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono font-bold text-amber-400">
                            {Number(inv.amount).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            <span className="text-xs text-texter-text-muted">
                              {inv.currency || "USD"}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono text-texter-text-muted">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-texter-text-dim" />
                              {formatAge(inv.created_at)}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => handleMarkInvoicePaid(inv)}
                              disabled={isMarking}
                              className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold inline-flex items-center gap-1.5 transition-all disabled:opacity-50"
                            >
                              {isMarking ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {isMarking ? "Marcando..." : "Marcar pagada"}
                              </span>
                            </button>
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

      {/* Modal Crear / Editar Suscripción */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl nextex-panel bg-texter-surface border border-texter-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-texter-border flex items-center justify-between bg-texter-surface-subtle/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-texter-indigo/15 border border-indigo-500/30 flex items-center justify-center text-texter-indigo">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {modalMode === "create"
                      ? "Nueva Suscripción"
                      : "Editar Suscripción"}
                  </h3>
                  <p className="text-[11px] text-texter-text-muted">
                    Configuración de cobro recurrente y estado operativo
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
              onSubmit={handleSaveSubscription}
              className="p-5 space-y-4 overflow-y-auto flex-1"
            >
              {formError && (
                <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0 text-texter-rose" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Cliente */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Cliente <span className="text-texter-rose">*</span>
                </label>
                {modalMode === "create" ? (
                  <select
                    required
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    <option value="">Selecciona un cliente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled
                    value={formClientName}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-texter-border text-xs text-texter-text-muted font-semibold cursor-not-allowed"
                  />
                )}
              </div>

              {/* Plan Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white block">
                  Nombre del Plan <span className="text-texter-rose">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formPlanName}
                  onChange={(e) => setFormPlanName(e.target.value)}
                  placeholder="ej. Plan Satélite Enterprise"
                  className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-indigo transition-colors"
                />
              </div>

              {/* Monto y Moneda */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Monto Mensual <span className="text-texter-rose">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Moneda
                  </label>
                  <select
                    value={formCurrency}
                    onChange={(e) =>
                      setFormCurrency(e.target.value as SubscriptionCurrency)
                    }
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    <option value="USD">USD — Dólares</option>
                    <option value="DOP">DOP — Pesos Dominicanos</option>
                  </select>
                </div>
              </div>

              {/* Día de cobro y Días de gracia */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Día de cobro (1 - 28)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    required
                    value={formBillingDay}
                    onChange={(e) => setFormBillingDay(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Días de gracia (grace_days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    required
                    value={formGraceDays}
                    onChange={(e) => setFormGraceDays(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>
              </div>

              {/* Próximo cobro y Estado */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Próxima factura (next_invoice_date)
                  </label>
                  <input
                    type="date"
                    required
                    value={formNextInvoiceDate}
                    onChange={(e) => setFormNextInvoiceDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono focus:outline-none focus:border-texter-indigo transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white block">
                    Estado de la suscripción
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as SubscriptionStatus)
                    }
                    className="w-full px-3 py-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white focus:outline-none focus:border-texter-indigo transition-colors"
                  >
                    <option value="active">Activa (active)</option>
                    <option value="past_due">En mora (past_due)</option>
                    <option value="suspended">Suspendida (suspended)</option>
                    <option value="cancelled">Cancelada (cancelled)</option>
                  </select>
                </div>
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
                    ? "Crear suscripción"
                    : "Guardar cambios"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
