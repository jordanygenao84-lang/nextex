"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import {
  Mail,
  ArrowRight,
  RotateCw,
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "tu correo electrónico";
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  const handleResend = async () => {
    if (!email || email === "tu correo electrónico") return;
    setIsResending(true);
    setResendStatus(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (error) {
        setResendStatus("No fue posible reenviar el correo en este momento. Inténtalo más tarde.");
      } else {
        setResendStatus("Enlace reenviado con éxito. Por favor revisa tu bandeja de entrada o spam.");
      }
    } catch {
      setResendStatus("Error al conectar con el servidor de autenticación.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-texter-bg flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-texter-indigo/10 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[250px] bg-texter-cyan/5 blur-[100px] pointer-events-none rounded-full" />

      {/* Brand Header */}
      <Link href="/" className="mb-8 z-10 hover:opacity-90 transition-opacity">
        <Logo variant="full" size="lg" showTagline={true} />
      </Link>

      <div className="w-full max-w-md z-10">
        <Card variant="elevated" padding="lg" className="border-texter-border/80 shadow-2xl text-center">
          {/* Animated Mail Icon */}
          <div className="w-14 h-14 rounded-2xl bg-texter-indigo/15 border border-indigo-500/30 flex items-center justify-center text-texter-cyan mx-auto mb-5 shadow-texter-glow-indigo">
            <Mail className="w-7 h-7" />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
            Revisa tu correo
          </h1>
          <p className="text-xs sm:text-sm text-texter-text-secondary leading-relaxed mb-4">
            Hemos enviado un enlace de confirmación seguro a:
          </p>

          <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border font-mono text-xs sm:text-sm text-texter-cyan font-semibold mb-6 break-all">
            {email}
          </div>

          <p className="text-xs text-texter-text-muted leading-relaxed mb-6">
            Haz clic en el enlace del correo para verificar tu cuenta y comenzar a utilizar NEXTEХ. Si no lo encuentras, revisa tu carpeta de spam.
          </p>

          {resendStatus && (
            <div
              className={`p-3 rounded-xl text-xs mb-5 border ${
                resendStatus.includes("éxito")
                  ? "bg-texter-emerald/10 border-emerald-500/30 text-emerald-300"
                  : "bg-texter-rose/10 border-rose-500/30 text-rose-300"
              }`}
            >
              {resendStatus}
            </div>
          )}

          <div className="space-y-3">
            <Button
              variant="secondary"
              size="md"
              className="w-full justify-center"
              onClick={handleResend}
              isLoading={isResending}
              leftIcon={<RotateCw className="w-4 h-4" />}
            >
              Reenviar correo de confirmación
            </Button>

            <Link href="/login" className="block w-full">
              <Button
                variant="ghost"
                size="md"
                className="w-full justify-center text-texter-text-secondary"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
              >
                Volver a Iniciar Sesión
              </Button>
            </Link>
          </div>

          <div className="mt-6 pt-5 border-t border-texter-border/60 flex items-center justify-center gap-1.5 text-xs text-texter-text-dim">
            <ShieldCheck className="w-4 h-4 text-texter-emerald" />
            <span>Verificación gestionada por Supabase Auth</span>
          </div>
        </Card>

        <p className="text-center text-xs text-texter-text-dim mt-4 font-mono">
          NEXTEХ es una plataforma desarrollada por Nexora Texter
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-texter-bg flex items-center justify-center text-xs font-mono text-texter-text-muted">
          Cargando verificación...
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
