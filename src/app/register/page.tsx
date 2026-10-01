"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import {
  Mail,
  Lock,
  User,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Github,
  Globe,
} from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [plan, setPlan] = useState<"free" | "pro" | "enterprise">("free");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthNote, setOauthNote] = useState<string | null>(null);

  const validateForm = () => {
    if (!name.trim()) {
      setError("El nombre completo es obligatorio.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Introduce un correo electrónico válido.");
      return false;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return false;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOauthNote(null);

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const supabase = createClient();
      const origin = window.location.origin;

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
          data: {
            full_name: name.trim(),
            selected_plan: plan,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("already registered") || signUpError.status === 400 && signUpError.message.toLowerCase().includes("user")) {
          setError("Este correo electrónico ya se encuentra registrado. Por favor inicia sesión.");
        } else if (signUpError.message.includes("Password")) {
          setError("La contraseña no cumple los requisitos mínimos de seguridad.");
        } else {
          setError(signUpError.message || "Error al procesar el registro.");
        }
        setIsLoading(false);
        return;
      }

      // Si Supabase requiere confirmación de email (sesión nula)
      if (data?.user && !data.session) {
        router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
      } else {
        // Sesión establecida directamente
        router.push("/dashboard");
      }
    } catch {
      setError("Error de comunicación con el servicio de autenticación.");
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
      <div className="absolute top-1/4 right-1/2 translate-x-1/2 w-[550px] h-[300px] bg-texter-indigo/10 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute bottom-1/4 right-1/3 w-[450px] h-[250px] bg-texter-cyan/5 blur-[110px] pointer-events-none rounded-full" />

      {/* Top Brand Link */}
      <Link href="/" className="mb-8 z-10 hover:opacity-90 transition-opacity">
        <Logo variant="full" size="lg" showTagline={true} />
      </Link>

      {/* Card Container */}
      <div className="w-full max-w-lg z-10">
        <Card variant="elevated" padding="lg" className="border-texter-border/80 shadow-2xl">
          {/* Header */}
          <div className="text-center space-y-1.5 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Crear cuenta en NEXTEХ
            </h1>
            <p className="text-xs text-texter-text-muted">
              Comienza a orquestar agentes y pipelines autónomos de inmediato
            </p>
          </div>

          {/* Social Auth Providers */}
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
              O con correo electrónico
            </span>
          </div>

          {/* Plan Selector Bar */}
          <div className="space-y-1.5 mb-5">
            <label className="text-xs font-medium text-texter-text-secondary">
              Selecciona tu plan inicial de desarrollo
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPlan("free")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  plan === "free"
                    ? "bg-texter-cyan/15 border-cyan-500/40 text-white shadow-sm"
                    : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
                }`}
              >
                <div className="text-xs font-bold text-white">Free</div>
                <div className="text-[10px] text-texter-text-dim mt-0.5 font-mono">Para inicio</div>
              </button>

              <button
                type="button"
                onClick={() => setPlan("pro")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  plan === "pro"
                    ? "bg-texter-indigo/15 border-indigo-500/40 text-white shadow-sm"
                    : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
                }`}
              >
                <div className="text-xs font-bold text-white flex items-center justify-between">
                  Pro
                  <span className="text-[9px] px-1 py-0.2 rounded bg-texter-indigo/20 text-indigo-300">★</span>
                </div>
                <div className="text-[10px] text-texter-text-dim mt-0.5 font-mono">Agentes Ilimitados</div>
              </button>

              <button
                type="button"
                onClick={() => setPlan("enterprise")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  plan === "enterprise"
                    ? "bg-purple-500/15 border-purple-500/40 text-white shadow-sm"
                    : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
                }`}
              >
                <div className="text-xs font-bold text-white">Enterprise</div>
                <div className="text-[10px] text-texter-text-dim mt-0.5 font-mono">Dedicado</div>
              </button>
            </div>
            <p className="text-[10px] text-texter-text-dim">
              * La activación efectiva de cuotas se rige por políticas del backend.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 mb-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-texter-rose" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nombre completo"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordany Genao"
              leftIcon={<User className="w-4 h-4" />}
              required
            />

            <Input
              label="Correo electrónico corporativo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@empresa.com"
              leftIcon={<Mail className="w-4 h-4" />}
              required
            />

            <Input
              label="Contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              leftIcon={<Lock className="w-4 h-4" />}
              required
            />

            <Input
              label="Confirmar contraseña"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite tu contraseña"
              leftIcon={<Lock className="w-4 h-4" />}
              required
            />

            <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-emerald-400 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Protección de cuenta activa con Supabase Auth</span>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center mt-2"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {isLoading ? "Creando cuenta..." : "Completar Registro y Acceder"}
            </Button>
          </form>

          {/* Footer Link */}
          <div className="mt-6 pt-5 border-t border-texter-border/60 flex items-center justify-between text-xs text-texter-text-muted">
            <div className="flex items-center gap-1.5 text-texter-text-dim">
              <ShieldCheck className="w-4 h-4 text-texter-emerald" />
              <span>Aislamiento estricto de datos con RLS</span>
            </div>
            <Link
              href="/login"
              className="text-texter-indigo hover:text-indigo-300 font-medium transition-colors"
            >
              ¿Ya tienes cuenta? Inicia sesión
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
