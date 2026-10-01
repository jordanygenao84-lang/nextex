"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import {
  Mail,
  Lock,
  User,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("Jordany Genao");
  const [email, setEmail] = useState("Jordanygenao84@gmail.com");
  const [password, setPassword] = useState("Nextex2026!Secure");
  const [plan, setPlan] = useState<"pro" | "free">("pro");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      router.push("/dashboard");
    }, 1000);
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

          {/* Plan Selector Bar */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button
              type="button"
              onClick={() => setPlan("pro")}
              className={`p-3 rounded-xl border text-left transition-all ${
                plan === "pro"
                  ? "bg-texter-indigo/15 border-indigo-500/40 text-white shadow-sm"
                  : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Plan Pro</span>
                <Badge variant="indigo" size="sm">Recomendado</Badge>
              </div>
              <p className="text-[11px] text-texter-text-muted mt-1">
                Agentes ilimitados, multi-modelo y Supabase RLS dedicado.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setPlan("free")}
              className={`p-3 rounded-xl border text-left transition-all ${
                plan === "free"
                  ? "bg-texter-cyan/15 border-cyan-500/40 text-white shadow-sm"
                  : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Developer</span>
                <span className="text-[10px] font-mono text-texter-text-dim">Gratis</span>
              </div>
              <p className="text-[11px] text-texter-text-muted mt-1">
                Exploración inicial de tareas y telemetría de IA.
              </p>
            </button>
          </div>

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

            <div className="space-y-1">
              <Input
                label="Contraseña"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />
              <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Nivel de seguridad alto (Cifrado SHA-256)</span>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center mt-2"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Completar Registro y Acceder a NEXTEХ
            </Button>
          </form>

          {/* Footer Link */}
          <div className="mt-6 pt-5 border-t border-texter-border/60 flex items-center justify-between text-xs text-texter-text-muted">
            <div className="flex items-center gap-1.5 text-texter-text-dim">
              <ShieldCheck className="w-4 h-4 text-texter-emerald" />
              <span>Aislamiento estricto de datos</span>
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
