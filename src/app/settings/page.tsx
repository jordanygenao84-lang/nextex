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
  Layers,
  ArrowRight,
  Users,
  Shield,
  Check,
  Ban,
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
          .select("*, profiles(full_name, avatar_url)")
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
  }, [workspace?.id, user?.id, user?.email, profile?.full_name]);

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

  const userPlan = (profile?.plan || "free").toUpperCase();
  const userStatus = profile?.status || "active";

  return (
    <DashboardShell
      title="Configuración de Cuenta & Perfil"
      subtitle="Gestión de identidad, espacio de trabajo personal y seguridad"
    >
      <div className="max-w-4xl space-y-6">
        {/* Status / Feedback message */}
        {feedback && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${
              feedback.type === "success"
                ? "bg-texter-emerald/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-rose-500/30 text-rose-300"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
            )}
            <span>{feedback.message}</span>
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
                Miembros & Gobernanza de Permisos (Fase 4.4)
              </h2>
              <p className="text-xs text-texter-text-muted mt-0.5">
                Catálogo de 22 permisos canónicos con precedencia Deny-First y control jerárquico
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="indigo" size="sm">
                22 Permisos
              </Badge>
              <Badge variant="cyan" size="sm">
                RBAC + Overrides
              </Badge>
            </div>
          </div>

          <div className="space-y-4">
            {/* Lista de Miembros */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-texter-text-secondary uppercase tracking-wider font-mono">
                Miembros del Workspace ({members.length})
              </h4>
              <div className="divide-y divide-texter-border/50 rounded-xl bg-texter-surface-subtle border border-texter-border overflow-hidden">
                {members.map((m) => {
                  const role = m.role || "member";
                  const rolePerms = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || [];
                  const userOverrides = overrides.filter((o) => o.user_id === m.user_id);

                  return (
                    <div
                      key={m.id || m.user_id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">
                            {m.profiles?.full_name || m.full_name || "Miembro"}
                          </span>
                          <Badge
                            variant={role === "owner" ? "indigo" : role === "admin" ? "cyan" : "default"}
                            size="sm"
                          >
                            {role.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-texter-text-muted font-mono text-[11px]">
                          ID: {m.user_id}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono text-texter-text-dim">
                          {rolePerms.length} permisos base
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
            <Badge variant={userPlan === "PRO" ? "indigo" : "default"} size="md">
              Plan {userPlan}
            </Badge>
          </div>

          <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-white">Nivel actual: {userPlan}</h4>
              <p className="text-xs text-texter-text-muted mt-0.5">
                {userPlan === "PRO"
                  ? "Acceso ampliado a agentes, pipelines en Edge y múltiples modelos LLM."
                  : "Nivel inicial para experimentación autónoma y pipelines de prueba."}
              </p>
            </div>
            <Link href="/dashboard#upgrade">
              <Button variant="outline" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Gestionar Suscripción
              </Button>
            </Link>
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
    </DashboardShell>
  );
}
