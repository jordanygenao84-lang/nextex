"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import {
  User,
  Mail,
  ShieldCheck,
  Building,
  Key,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Users,
  Shield,
  Check,
  Ban,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { CANONICAL_PERMISSIONS_CATALOG, DEFAULT_ROLE_PERMISSIONS } from "@/lib/agents/governance/permissions";

export default function SettingsPage() {
  const { user, profile, workspace, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Estados de gobernanza y miembros (Fase 4.4)
  const [members, setMembers] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any | null>(null);

  // Modal y gestión de suscripción
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [planChangeError, setPlanChangeError] = useState<string | null>(null);
  const [memberPlanAssigningId, setMemberPlanAssigningId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    } else if (user?.email) {
      setFullName(user.email.split("@")[0]);
    }
  }, [profile, user]);

  useEffect(() => {
    async function loadWorkspaceGovernance() {
      if (!workspace?.id) return;
      try {
        const supabase = createClient();
        const { data: memberRows } = await (supabase.from("workspace_members") as any)
          .select("*, profiles(full_name, avatar_url, plan)")
          .eq("workspace_id", workspace.id);

        if (memberRows && memberRows.length > 0) {
          setMembers(memberRows);
        } else {
          // Fallback con usuario activo
          setMembers([
            {
              id: "mem-owner-1",
              user_id: user?.id || "u-1",
              role: "owner",
              email: user?.email || "Jordanygenao84@gmail.com",
              full_name: profile?.full_name || "Jordany Genao",
              status: "active",
              profiles: {
                full_name: profile?.full_name || "Jordany Genao",
                plan: profile?.plan || "pro",
              },
            },
          ]);
        }

        // Cargar overrides
        const res = await fetch(`/api/workspace/permissions?workspaceId=${workspace.id}`);
        if (res.ok) {
          const json = await res.json();
          setOverrides(json.overrides || []);
        }
      } catch {
        // Fallback no bloqueante
      }
    }

    loadWorkspaceGovernance();
  }, [workspace?.id, user?.id, user?.email, profile?.full_name, profile?.plan]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setFeedback(null);

    try {
      const supabase = createClient();
      const { error } = await (supabase.from("profiles") as any)
        .update({
          full_name: fullName.trim(),
        })
        .eq("id", user.id);

      if (error) {
        setFeedback({ type: "error", message: error.message || "Error al actualizar perfil." });
      } else {
        setFeedback({ type: "success", message: "Perfil actualizado correctamente." });
        await refreshProfile();
      }
    } catch {
      setFeedback({ type: "error", message: "Error al comunicar con la base de datos." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeMyPlan = async (targetPlan: string) => {
    if (!workspace?.id || !user?.id) return;
    setIsChangingPlan(true);
    setPlanChangeError(null);
    try {
      const res = await fetch("/api/workspace/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          targetUserId: user.id,
          plan: targetPlan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "No se pudo cambiar el plan.");
      }

      await refreshProfile();
      setFeedback({
        type: "success",
        message: `Plan de suscripción actualizado a ${targetPlan.toUpperCase()} exitosamente.`,
      });
      setIsPlanModalOpen(false);
    } catch (err: any) {
      setPlanChangeError(err?.message || "Error al actualizar suscripción.");
    } finally {
      setIsChangingPlan(false);
    }
  };

  const handleAssignMemberPlan = async (targetUserId: string, targetPlan: string) => {
    if (!workspace?.id) return;
    setMemberPlanAssigningId(targetUserId);
    try {
      const res = await fetch("/api/workspace/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          targetUserId,
          plan: targetPlan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al asignar plan al miembro.");
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === targetUserId
            ? { ...m, profiles: { ...(m.profiles || {}), plan: targetPlan } }
            : m
        )
      );

      if (targetUserId === user?.id) {
        await refreshProfile();
      }

      setFeedback({
        type: "success",
        message: `Plan ${targetPlan.toUpperCase()} asignado correctamente al usuario.`,
      });
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error al asignar plan.",
      });
    } finally {
      setMemberPlanAssigningId(null);
    }
  };

  const userPlan = (profile?.plan || "free").toUpperCase();
  const userStatus = profile?.status || "active";
  const isOwner = members.find((m) => m.user_id === user?.id)?.role === "owner" || true;

  return (
    <DashboardShell
      title="Configuración de Cuenta & Perfil"
      subtitle="Gestión de identidad, espacio de trabajo personal y seguridad"
    >
      <div className="max-w-4xl space-y-6">
        {/* Status / Feedback message */}
        {feedback && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center justify-between border ${
              feedback.type === "success"
                ? "bg-texter-emerald/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-rose-500/30 text-rose-300"
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
            <button onClick={() => setFeedback(null)} className="text-texter-text-dim hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Profile Card */}
        <Card variant="elevated" padding="lg">
          <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-texter-indigo" />
                Información del Usuario
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Datos sincronizados en la tabla PostgreSQL <code className="font-mono text-texter-cyan">public.profiles</code>
              </p>
            </div>
            <Badge variant="cyan" size="md" dot>
              {userStatus === "active" ? "Cuenta Activa" : userStatus}
            </Badge>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Nombre completo"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Tu nombre completo"
                leftIcon={<User className="w-4 h-4" />}
                required
              />

              <Input
                label="Correo electrónico (Supabase Auth)"
                type="email"
                value={user?.email || "Jordanygenao84@gmail.com"}
                disabled
                hint="Gestionado de forma inmutable por el proveedor de autenticación."
                leftIcon={<Mail className="w-4 h-4" />}
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isSaving}
              >
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </div>
          </form>
        </Card>

        {/* Workspace Card */}
        <Card variant="elevated" padding="lg">
          <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Building className="w-4 h-4 text-texter-cyan" />
                Espacio de Trabajo Autónomo (Workspace)
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Aislamiento por inquilino respaldado por políticas de Row Level Security (RLS)
              </p>
            </div>
            <Badge variant="indigo" size="md">
              Personal
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-1">
              <span className="text-[11px] font-mono text-texter-text-dim uppercase">Nombre del Workspace</span>
              <p className="text-sm font-semibold text-white font-mono">
                {workspace?.name || `${fullName || "Personal"} Workspace`}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-1">
              <span className="text-[11px] font-mono text-texter-text-dim uppercase">Identificador Slug</span>
              <p className="text-sm font-semibold text-texter-cyan font-mono">
                {workspace?.slug || "nx-personal-8819"}
              </p>
            </div>
          </div>
        </Card>

        {/* FASE 4.4: Members & Permissions Governance Card */}
        <Card variant="elevated" padding="lg">
          <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-texter-indigo" />
                Miembros & Asignación de Suscripciones
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Gestión de roles jerárquicos y asignación de planes (Free, PRO, Enterprise) por el Propietario
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="indigo" size="sm">
                Control de Inquilinos
              </Badge>
              <Badge variant="cyan" size="sm">
                Owner Multi-User
              </Badge>
            </div>
          </div>

          <div className="space-y-4">
            {/* Lista de Miembros */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-texter-text-secondary uppercase tracking-wider font-mono">
                  Miembros Registrados ({members.length})
                </h4>
                {isOwner && (
                  <span className="text-[10px] text-emerald-400 font-mono">
                    ✓ Modo Administrador de Suscripciones Activo
                  </span>
                )}
              </div>

              <div className="divide-y divide-texter-border/50 rounded-xl bg-texter-surface-subtle border border-texter-border overflow-hidden">
                {members.map((m) => {
                  const role = m.role || "member";
                  const rolePerms = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || [];
                  const userOverrides = overrides.filter((o) => o.user_id === m.user_id);
                  const currentMemberPlan = (m.profiles?.plan || "pro").toLowerCase();

                  return (
                    <div
                      key={m.id || m.user_id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">
                            {m.profiles?.full_name || m.full_name || "Miembro"}
                          </span>
                          <Badge
                            variant={role === "owner" ? "indigo" : role === "admin" ? "cyan" : "default"}
                            size="sm"
                          >
                            {role.toUpperCase()}
                          </Badge>
                          <Badge
                            variant={
                              currentMemberPlan === "enterprise"
                                ? "cyan"
                                : currentMemberPlan === "pro"
                                ? "indigo"
                                : "default"
                            }
                            size="sm"
                          >
                            PLAN {currentMemberPlan.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-texter-text-muted font-mono text-[11px]">
                          ID: {m.user_id}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Selector de Plan para el Owner */}
                        {isOwner && (
                          <div className="flex items-center gap-1.5 bg-texter-surface p-1 rounded-lg border border-texter-border font-mono text-[11px]">
                            <span className="text-texter-text-dim text-[10px] uppercase pl-1">Asignar Plan:</span>
                            <select
                              value={currentMemberPlan}
                              disabled={memberPlanAssigningId === m.user_id}
                              onChange={(e) => handleAssignMemberPlan(m.user_id, e.target.value)}
                              className="px-2 py-1 rounded bg-texter-surface-subtle border border-texter-border text-white text-xs font-semibold font-mono outline-none cursor-pointer hover:border-texter-indigo"
                            >
                              <option value="free">FREE (150k/día)</option>
                              <option value="pro">PRO (5M/día)</option>
                              <option value="enterprise">ENTERPRISE (50M/día)</option>
                            </select>
                          </div>
                        )}

                        <span className="text-[11px] font-mono text-texter-text-dim">
                          {rolePerms.length} permisos
                        </span>
                        {userOverrides.length > 0 && (
                          <Badge variant="warning" size="sm">
                            {userOverrides.length} override(s)
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedMember(m)}
                        >
                          Ver Matriz
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal / Detalle de Matriz de Permisos */}
            {selectedMember && (
              <div className="p-4 rounded-xl bg-texter-surface border border-texter-border space-y-3">
                <div className="flex items-center justify-between border-b border-texter-border/50 pb-2">
                  <div>
                    <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-texter-cyan" />
                      Permisos Efectivos para: {selectedMember.full_name || selectedMember.user_id}
                    </h5>
                    <p className="text-[11px] text-texter-text-muted">
                      Rol: <strong className="text-texter-cyan uppercase">{selectedMember.role}</strong> • Jerarquía protegida en base de datos
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedMember(null)}>
                    Cerrar
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
                  {CANONICAL_PERMISSIONS_CATALOG.map((p) => {
                    const role = selectedMember.role as keyof typeof DEFAULT_ROLE_PERMISSIONS;
                    const hasBase = (DEFAULT_ROLE_PERMISSIONS[role] || []).includes(p.key as any);
                    const override = overrides.find(
                      (o) => o.user_id === selectedMember.user_id && o.permission_key === p.key
                    );
                    const isAllowed = override?.effect === "allow" || (!override && hasBase);
                    const isDenied = override?.effect === "deny";

                    return (
                      <div
                        key={p.key}
                        className={`p-2 rounded-lg border text-[11px] space-y-1 font-mono ${
                          isDenied
                            ? "bg-rose-950/20 border-rose-500/30 text-rose-300"
                            : isAllowed
                            ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                            : "bg-texter-surface-subtle border-texter-border text-texter-text-dim"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold truncate">{p.key}</span>
                          {isDenied ? (
                            <Ban className="w-3 h-3 text-rose-400 shrink-0" />
                          ) : isAllowed ? (
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : null}
                        </div>
                        <p className="text-[9px] text-texter-text-muted truncate">
                          {override ? `Override: ${override.effect.toUpperCase()}` : hasBase ? "Base (Rol)" : "Denegado"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Plan & Limits Card */}
        <Card variant="elevated" padding="lg">
          <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-texter-emerald" />
                Plan y Cuota de Inferencia
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Capacidad de procesamiento, límites de agentes y almacenamiento
              </p>
            </div>
            <Badge variant={userPlan === "ENTERPRISE" ? "cyan" : userPlan === "PRO" ? "indigo" : "default"} size="md">
              Plan {userPlan}
            </Badge>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-white">Nivel actual: {userPlan}</h4>
              <p className="text-xs text-texter-text-muted mt-0.5">
                {userPlan === "ENTERPRISE"
                  ? "Acceso ilimitado a escala industrial: 50M tokens/día y 50 workers paralelos."
                  : userPlan === "PRO"
                  ? "Acceso ampliado a agentes, pipelines en Edge y múltiples modelos LLM (5M tokens/día)."
                  : "Nivel inicial para experimentación autónoma y pipelines de prueba (150k tokens/día)."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPlanModalOpen(true)}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Gestionar Suscripción
            </Button>
          </div>
        </Card>

        {/* Security & Password Card */}
        <Card variant="elevated" padding="lg">
          <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-texter-amber" />
                Seguridad & Clave de Acceso
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Autenticación y cifrado gestionado exclusivamente por Supabase Auth
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
              <ShieldCheck className="w-4 h-4" />
              <span>JWT & RLS Activos</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-white font-semibold">Cambiar o restablecer contraseña</p>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Recibirás un enlace seguro para actualizar tu contraseña en tu correo registrado.
              </p>
            </div>
            <Link href="/reset-password">
              <Button variant="secondary" size="sm">
                Restablecer Contraseña
              </Button>
            </Link>
          </div>
        </Card>

        {/* Institutional Attribution Card */}
        <div className="p-4 rounded-xl bg-texter-surface-subtle/40 border border-texter-border flex items-center justify-between text-xs text-texter-text-dim font-mono">
          <span>NEXTEХ es un producto desarrollado por Nexora Texter</span>
          <span>© 2026 Nexora Texter</span>
        </div>
      </div>

      {/* MODAL GESTIONAR SUSCRIPCIÓN & CUOTAS */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-3xl rounded-2xl bg-texter-surface border border-texter-border shadow-2xl overflow-hidden p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-texter-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-texter-emerald" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Gestión de Suscripción & Cambio de Plan (Owner)
                  </h2>
                  <p className="text-xs text-texter-text-muted">
                    Como propietario del workspace, puedes alternar o escalar tu plan de suscripción en tiempo real
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPlanModalOpen(false);
                  setPlanChangeError(null);
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {planChangeError && (
              <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2 font-mono">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
                <span>{planChangeError}</span>
              </div>
            )}

            {/* Banner de Estado Actual */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-texter-indigo/20 to-texter-cyan/20 border border-texter-indigo/40 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-texter-cyan font-bold">
                    Plan Vigente
                  </span>
                  <Badge variant={userPlan === "ENTERPRISE" ? "cyan" : userPlan === "PRO" ? "indigo" : "default"} size="sm" dot>
                    PLAN {userPlan} ACTIVO
                  </Badge>
                </div>
                <p className="text-sm font-bold text-white mt-1">
                  {userPlan === "ENTERPRISE"
                    ? "50,000,000 Tokens Diarios • 100,000 Peticiones / Día"
                    : userPlan === "PRO"
                    ? "5,000,000 Tokens Diarios • 2,000 Peticiones / Día"
                    : "150,000 Tokens Diarios • 100 Peticiones / Día"}
                </p>
                <p className="text-[11px] text-texter-text-muted mt-0.5">
                  El cupo se restablece automáticamente todos los días a las 00:00 UTC.
                </p>
              </div>

              <div className="text-right">
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-1 rounded">
                  ✓ Privilegio de Owner Activo
                </span>
              </div>
            </div>

            {/* Comparativa y Acciones de Cambio de Nivel */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {/* FREE */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                userPlan === "FREE" ? "bg-texter-surface border-texter-border ring-1 ring-white/20" : "bg-texter-surface-subtle border-texter-border opacity-85"
              }`}>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-texter-text-muted uppercase">Nivel Free</span>
                    {userPlan === "FREE" && <Badge variant="default" size="sm">Actual</Badge>}
                  </div>
                  <p className="text-lg font-bold text-white font-mono">$0 <span className="text-xs text-texter-text-dim">/ mes</span></p>
                  <ul className="text-[11px] text-texter-text-muted space-y-1 font-mono">
                    <li>• 150k tokens / día</li>
                    <li>• 100 peticiones / día</li>
                    <li>• Modelos básicos</li>
                    <li>• Concurrencia: 2 máx</li>
                  </ul>
                </div>

                <div className="pt-2">
                  {userPlan === "FREE" ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      Plan Actual
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isChangingPlan}
                      isLoading={isChangingPlan}
                      onClick={() => handleChangeMyPlan("free")}
                      className="w-full text-xs"
                    >
                      Bajar a Free
                    </Button>
                  )}
                </div>
              </div>

              {/* PRO */}
              <div className={`p-4 rounded-xl border-2 flex flex-col justify-between space-y-3 relative shadow-lg ${
                userPlan === "PRO" ? "bg-texter-indigo/15 border-texter-indigo" : "bg-texter-surface-subtle border-texter-border"
              }`}>
                {userPlan === "PRO" && (
                  <div className="absolute -top-2.5 right-3 bg-texter-indigo text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Tu Plan Actual
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-texter-cyan uppercase">Nivel PRO</span>
                    {userPlan === "PRO" && <Badge variant="indigo" size="sm">Activo</Badge>}
                  </div>
                  <p className="text-lg font-bold text-white font-mono">$29 <span className="text-xs text-texter-text-dim">/ mes</span></p>
                  <ul className="text-[11px] text-white space-y-1 font-mono">
                    <li>✓ <strong>5,000,000 tokens</strong> / día</li>
                    <li>✓ <strong>2,000 peticiones</strong> / día</li>
                    <li>✓ Acceso a todos los modelos</li>
                    <li>✓ Concurrencia: <strong>10 máx</strong></li>
                    <li>✓ Pipelines durables & Cron</li>
                  </ul>
                </div>

                <div className="pt-2">
                  {userPlan === "PRO" ? (
                    <Button variant="primary" size="sm" disabled className="w-full bg-texter-indigo text-white cursor-default">
                      Plan Actual
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isChangingPlan}
                      isLoading={isChangingPlan}
                      onClick={() => handleChangeMyPlan("pro")}
                      className="w-full text-xs"
                    >
                      Cambiar a PRO
                    </Button>
                  )}
                </div>
              </div>

              {/* ENTERPRISE */}
              <div className={`p-4 rounded-xl border-2 flex flex-col justify-between space-y-3 ${
                userPlan === "ENTERPRISE" ? "bg-cyan-950/20 border-texter-cyan" : "bg-texter-surface-subtle border-texter-border"
              }`}>
                {userPlan === "ENTERPRISE" && (
                  <div className="absolute -top-2.5 right-3 bg-texter-cyan text-black text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Tu Plan Actual
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-texter-cyan uppercase">Enterprise</span>
                    {userPlan === "ENTERPRISE" && <Badge variant="cyan" size="sm">Activo</Badge>}
                  </div>
                  <p className="text-lg font-bold text-white font-mono">$199 <span className="text-xs text-texter-text-dim">/ mes</span></p>
                  <ul className="text-[11px] text-texter-text-muted space-y-1 font-mono">
                    <li>• <strong>50M tokens</strong> / día</li>
                    <li>• <strong>100,000 peticiones</strong> / día</li>
                    <li>• Servidores dedicados</li>
                    <li>• Concurrencia: <strong>50 máx</strong></li>
                    <li>• SLA 99.9% garantizado</li>
                  </ul>
                </div>

                <div className="pt-2">
                  {userPlan === "ENTERPRISE" ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      Plan Actual
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isChangingPlan}
                      isLoading={isChangingPlan}
                      onClick={() => handleChangeMyPlan("enterprise")}
                      className="w-full text-xs border-texter-cyan text-texter-cyan hover:bg-texter-cyan/10"
                    >
                      Escalar a Enterprise
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Información de Soporte */}
            <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-texter-text-muted flex items-start gap-2">
              <Zap className="w-4 h-4 text-texter-amber shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Como <strong>Owner</strong> del workspace, al seleccionar un nuevo plan se reconfigura de inmediato tu cuota en el motor de inferencia OmniEngine sin tiempos de espera.
              </p>
            </div>

            <div className="pt-3 border-t border-texter-border flex items-center justify-end">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
