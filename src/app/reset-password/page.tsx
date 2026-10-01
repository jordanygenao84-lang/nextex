"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import { Mail, ArrowRight, ArrowLeft, ShieldCheck, CheckCircle2 } from "lucide-react";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setStatus({ type: "error", message: "Introduce un correo electrónico válido." });
      return;
    }

    setIsLoading(true);
    setStatus(null);

    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/update-password`,
      });

      if (error) {
        setStatus({
          type: "error",
          message: error.message || "No fue posible procesar la solicitud de recuperación.",
        });
      } else {
        setStatus({
          type: "success",
          message: "Hemos enviado un enlace de recuperación seguro a tu correo electrónico. Por favor revisa tu bandeja de entrada.",
        });
      }
    } catch {
      setStatus({
        type: "error",
        message: "Error de conexión con el servicio de autenticación.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-texter-bg flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-texter-indigo/10 blur-[120px] pointer-events-none rounded-full" />

      {/* Brand Header */}
      <Link href="/" className="mb-8 z-10 hover:opacity-90 transition-opacity">
        <Logo variant="full" size="lg" showTagline={true} />
      </Link>

      <div className="w-full max-w-md z-10">
        <Card variant="elevated" padding="lg" className="border-texter-border/80 shadow-2xl">
          <div className="text-center space-y-1.5 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Recuperar Contraseña
            </h1>
            <p className="text-xs text-texter-text-muted">
              Te enviaremos un enlace seguro para restablecer tu acceso a NEXTEХ
            </p>
          </div>

          {status && (
            <div
              className={`p-3.5 rounded-xl text-xs mb-5 border ${
                status.type === "success"
                  ? "bg-texter-emerald/10 border-emerald-500/30 text-emerald-300"
                  : "bg-texter-rose/10 border-rose-500/30 text-rose-300"
              }`}
            >
              {status.message}
            </div>
          )}

          {status?.type === "success" ? (
            <div className="space-y-4">
              <Link href="/login" className="block w-full">
                <Button variant="primary" size="lg" className="w-full justify-center">
                  Volver al Inicio de Sesión
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Correo electrónico de tu cuenta"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center mt-2"
                isLoading={isLoading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                {isLoading ? "Enviando enlace..." : "Enviar enlace de recuperación"}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-texter-border/60 flex items-center justify-between text-xs text-texter-text-muted">
            <div className="flex items-center gap-1.5 text-texter-text-dim">
              <ShieldCheck className="w-4 h-4 text-texter-emerald" />
              <span>Protección de cuenta activa</span>
            </div>
            <Link
              href="/login"
              className="text-texter-indigo hover:text-indigo-300 font-medium transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver</span>
            </Link>
          </div>
        </Card>

        <p className="text-center text-xs text-texter-text-dim mt-4 font-mono">
          NEXTEХ es una plataforma desarrollada por Nexora Texter
        </p>
      </div>
    </div>
  );
}
