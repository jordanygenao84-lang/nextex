"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/context/AuthContext";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  LogIn,
} from "lucide-react";

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const { user, isLoading: isAuthLoading } = useAuth();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!user) {
      // Si el usuario no ha iniciado sesión, redirigir a login preservando el retorno
      const redirectUrl = token
        ? `/login?redirect=${encodeURIComponent(`/invite?token=${token}`)}`
        : "/login";
      router.push(redirectUrl);
      return;
    }

    if (!token || !token.trim()) {
      setStatus("error");
      setErrorMessage("No se proporcionó un token de invitación válido.");
      setErrorCode("MISSING_TOKEN");
      return;
    }

    // Llamar al endpoint de aceptación de invitación
    async function acceptInvite() {
      try {
        const res = await fetch(`/api/invites/accept?token=${encodeURIComponent(token!)}`);
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.ok) {
          setStatus("success");
          setWorkspaceId(data.workspace_id || null);
        } else {
          setStatus("error");
          setErrorCode(data?.error?.code || null);
          if (res.status === 410 || data?.error?.code === "EXPIRED") {
            setErrorMessage("Esta invitación ha expirado. Solicita al administrador un nuevo enlace.");
          } else if (res.status === 409 || data?.error?.code === "ALREADY_ACCEPTED") {
            setErrorMessage("Esta invitación ya fue aceptada previamente.");
          } else if (res.status === 404 || data?.error?.code === "NOT_FOUND") {
            setErrorMessage("El enlace de invitación no es válido o no existe.");
          } else {
            setErrorMessage(data?.error?.message || "Ocurrió un error al procesar tu invitación.");
          }
        }
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(err?.message || "Error de conexión al validar la invitación.");
      }
    }

    acceptInvite();
  }, [user, isAuthLoading, token, router]);

  if (isAuthLoading || (!user && status === "loading")) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-texter-cyan" />
        <p className="text-xs font-mono text-texter-text-muted">Verificando credenciales...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {status === "loading" && (
        <div className="text-center space-y-4 py-8">
          <Loader2 className="w-10 h-10 animate-spin text-texter-cyan mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">Procesando invitación</h3>
            <p className="text-xs text-texter-text-muted">
              Vinculando tu cuenta al espacio de trabajo asignado...
            </p>
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="text-center space-y-5 py-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white">¡Bienvenido al Workspace!</h3>
            <p className="text-xs text-texter-text-muted leading-relaxed max-w-sm mx-auto">
              Tu invitación ha sido aceptada exitosamente. Ya tienes acceso a los recursos, tareas y agentes configurados para este negocio.
            </p>
          </div>

          <div className="pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push("/dashboard")}
              className="w-full flex items-center justify-center gap-2 shadow-sm font-semibold"
            >
              <span>Ir al Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="text-center space-y-5 py-4">
          <div className="w-14 h-14 rounded-2xl bg-texter-rose/20 border border-texter-rose/30 flex items-center justify-center text-texter-rose mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white">Invitación no válida</h3>
            <p className="text-xs text-rose-300 leading-relaxed max-w-sm mx-auto bg-texter-rose/10 p-3 rounded-xl border border-texter-rose/20">
              {errorMessage}
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/dashboard")}
              className="w-full flex items-center justify-center gap-2"
            >
              <span>Ir al Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/login")}
              className="text-xs text-texter-text-dim hover:text-white"
            >
              Cambiar de cuenta
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <div className="min-h-screen bg-texter-bg flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo variant="full" size="md" />
        </div>

        <Card variant="elevated" className="bg-texter-surface border-texter-border p-6 shadow-2xl">
          <Suspense
            fallback={
              <div className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-texter-cyan" />
                <p className="text-xs font-mono text-texter-text-muted">Cargando...</p>
              </div>
            }
          >
            <InviteContent />
          </Suspense>
        </Card>

        <p className="text-center text-[11px] font-mono text-texter-text-dim">
          NEXTEХ OS • Sistema de Invitaciones Seguras por Token
        </p>
      </div>
    </div>
  );
}
