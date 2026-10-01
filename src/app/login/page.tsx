"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import {
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  Github,
  Globe,
  AlertCircle,
} from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthNote, setOauthNote] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOauthNote(null);

    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      setError("Introduce tu correo electrónico.");
      return;
    }

    if (!password) {
      setError("Introduce tu contraseña.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });

      if (signInError) {
        if (
          signInError.message.toLowerCase().includes("invalid login credentials") ||
          signInError.message.toLowerCase().includes("invalid grant")
        ) {
          setError("Correo electrónico o contraseña incorrectos.");
        } else if (signInError.message.toLowerCase().includes("email not confirmed")) {
          setError("Tu correo electrónico aún no ha sido confirmado. Revisa tu bandeja de entrada.");
        } else {
          setError(signInError.message || "No fue posible iniciar sesión.");
        }
        setIsLoading(false);
        return;
      }

      if (data?.session) {
        router.push(redirectPath);
        router.refresh();
      }
    } catch {
      setError("Error al comunicar con el servicio de autenticación.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuth = (provider: "google" | "github") => {
    setOauthNote(
      `La integración OAuth con ${provider === "google" ? "Google" : "GitHub"} requiere activar las credenciales oficiales en el Dashboard de Supabase bajo la cuenta Jordanygenao84@gmail.com.`
    );
  };

  return (
    <div className="min-h-screen bg-texter-bg flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-texter-indigo/10 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[250px] bg-texter-cyan/5 blur-[100px] pointer-events-none rounded-full" />

      {/* Top Brand Link */}
      <Link href="/" className="mb-8 z-10 hover:opacity-90 transition-opacity">
        <Logo variant="full" size="lg" showTagline={true} />
      </Link>

      {/* Card Container */}
      <div className="w-full max-w-md z-10">
        <Card variant="elevated" padding="lg" className="border-texter-border/80 shadow-2xl">
          {/* Header */}
          <div className="text-center space-y-1.5 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Acceder a NEXTEХ
            </h1>
            <p className="text-xs text-texter-text-muted">
              Plataforma de inteligencia artificial, agentes y automatización
            </p>
          </div>

          {/* Social Auth Buttons */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button
              type="button"
              onClick={() => handleOAuth("github")}
              className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-xs font-medium text-texter-text-secondary hover:text-white transition-all"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-xs font-medium text-texter-text-secondary hover:text-white transition-all"
            >
              <Globe className="w-4 h-4 text-texter-cyan" />
              <span>Google SSO</span>
            </button>
          </div>

          {oauthNote && (
            <div className="mb-5 p-3 rounded-xl bg-texter-amber/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{oauthNote}</span>
            </div>
          )}

          {/* Divider */}
          <div className="relative flex items-center justify-center mb-6">
            <div className="w-full border-t border-texter-border/60" />
            <span className="absolute bg-texter-surface px-3 text-[11px] text-texter-text-dim uppercase tracking-wider font-mono">
              O con correo corporativo
            </span>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Correo electrónico"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@empresa.com"
              leftIcon={<Mail className="w-4 h-4" />}
              required
            />

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium text-texter-text-secondary">
                  Contraseña
                </label>
                <Link
                  href="/reset-password"
                  className="text-[11px] text-texter-indigo hover:text-indigo-400 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-texter-rose" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center mt-2"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {isLoading ? "Iniciando sesión..." : "Iniciar Sesión en NEXTEХ"}
            </Button>
          </form>

          {/* Footer Security Note */}
          <div className="mt-6 pt-5 border-t border-texter-border/60 flex items-center justify-between text-xs text-texter-text-muted">
            <div className="flex items-center gap-1.5 text-texter-text-dim">
              <ShieldCheck className="w-4 h-4 text-texter-emerald" />
              <span>Protección de cuenta activa</span>
            </div>
            <Link
              href="/register"
              className="text-texter-indigo hover:text-indigo-300 font-medium transition-colors"
            >
              Crear cuenta
            </Link>
          </div>
        </Card>

        {/* Institutional subtitle */}
        <p className="text-center text-xs text-texter-text-dim mt-4 font-mono">
          NEXTEХ es una plataforma desarrollada por Nexora Texter
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-texter-bg flex items-center justify-center text-xs font-mono text-texter-text-muted">
          Cargando acceso...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
