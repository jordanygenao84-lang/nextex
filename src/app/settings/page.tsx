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
} from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  const { user, profile, workspace, refreshProfile, signOut } = useAuth();
  const [fullName, setFullName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    } else if (user?.email) {
      setFullName(user.email.split("@")[0]);
    }
  }, [profile, user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setFeedback(null);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
        } as never)
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
