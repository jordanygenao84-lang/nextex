"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import { Lock, ArrowRight, ShieldCheck, CheckCircle2 } from "lucide-react";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message || "No fue posible actualizar la contraseña.");
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      }
    } catch {
      setError("Error al comunicar con el servidor.");
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
              Nueva Contraseña
            </h1>
            <p className="text-xs text-texter-text-muted">
              Define tu nueva clave de acceso para tu cuenta en NEXTEХ
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 mb-4">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-4 rounded-xl bg-texter-emerald/10 border border-emerald-500/30 text-emerald-300 text-xs text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="font-semibold text-sm">Contraseña actualizada exitosamente</p>
              <p className="text-texter-text-muted">Redirigiendo a tu espacio de trabajo...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nueva contraseña"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />

              <Input
                label="Confirmar nueva contraseña"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu contraseña"
                leftIcon={<Lock className="w-4 h-4" />}
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
                {isLoading ? "Actualizando contraseña..." : "Guardar Nueva Contraseña"}
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
              className="text-texter-indigo hover:text-indigo-300 font-medium transition-colors"
            >
              Iniciar sesión
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
