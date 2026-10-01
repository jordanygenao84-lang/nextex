import React from "react";
import Link from "next/link";
import { Navbar } from "@/components/landing/Navbar";
import { PipelineDemo } from "@/components/landing/PipelineDemo";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  ArrowRight,
  Sparkles,
  Zap,
  Terminal,
  ShieldCheck,
  Cpu,
  Layers,
  CheckCircle2,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-texter-bg text-texter-text-primary flex flex-col selection:bg-texter-indigo/30 selection:text-white">
      {/* Navigation */}
      <Navbar />

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-texter-indigo/15 blur-[140px] pointer-events-none rounded-full" />
        <div className="absolute top-1/3 left-1/3 w-[500px] h-[250px] bg-texter-cyan/10 blur-[130px] pointer-events-none rounded-full" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          {/* Badge indicator */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-texter-surface border border-texter-border shadow-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-texter-cyan animate-pulse" />
            <span className="text-xs font-mono font-semibold text-white">
              NEXTEХ • AI & AUTOMATION PLATFORM
            </span>
            <span className="text-texter-border">|</span>
            <span className="text-xs text-texter-text-muted">Desarrollado por Nexora Texter</span>
          </div>

          {/* Main Title */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl mx-auto leading-[1.1] mb-6">
            Orquesta inteligencia artificial autónoma con{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-texter-indigo via-indigo-300 to-texter-cyan">
              precisión técnica.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg lg:text-xl text-texter-text-secondary max-w-3xl mx-auto leading-relaxed mb-10">
            NEXTEХ trasciende los chatbots convencionales. Conecta modelos de vanguardia con agentes especializados, ejecución de tareas en segundo plano y estricto aislamiento de datos.
          </p>

          {/* Call to Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
            <Link href="/dashboard" className="w-full sm:w-auto">
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto justify-center"
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Abrir Centro de Control
              </Button>
            </Link>
            <Link href="/chat" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto justify-center"
                leftIcon={<Sparkles className="w-4 h-4 text-texter-cyan" />}
              >
                Espacio de Chat y Agentes
              </Button>
            </Link>
          </div>

          {/* Preview Hero Mockup Card */}
          <div className="max-w-5xl mx-auto">
            <Card
              variant="elevated"
              padding="none"
              className="border-texter-border/90 shadow-2xl overflow-hidden text-left"
            >
              {/* Window Controls Bar */}
              <div className="h-10 bg-texter-surface-subtle px-4 border-b border-texter-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-texter-rose/80" />
                  <span className="w-3 h-3 rounded-full bg-texter-amber/80" />
                  <span className="w-3 h-3 rounded-full bg-texter-emerald/80" />
                  <span className="text-xs font-mono text-texter-text-dim ml-2">
                    nextex.app/dashboard
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-texter-text-dim">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Supabase Conectado
                  </span>
                  <span>•</span>
                  <span>Vercel Edge</span>
                </div>
              </div>

              {/* Quick Preview Dashboard Content */}
              <div className="p-6 bg-texter-surface/60 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-texter-surface border border-texter-border">
                  <div className="flex justify-between items-center text-xs text-texter-text-muted mb-2">
                    <span>Inferencia Concurrente</span>
                    <Badge variant="cyan" size="sm">410ms p95</Badge>
                  </div>
                  <div className="text-2xl font-bold font-mono text-white">1.42M Tokens</div>
                  <div className="text-xs text-emerald-400 mt-1 font-mono">+18.4% eficiencia</div>
                </div>

                <div className="p-4 rounded-xl bg-texter-surface border border-texter-border">
                  <div className="flex justify-between items-center text-xs text-texter-text-muted mb-2">
                    <span>Agentes Autónomos</span>
                    <Badge variant="indigo" size="sm">4 Activos</Badge>
                  </div>
                  <div className="text-2xl font-bold font-mono text-white">3,892 Tareas</div>
                  <div className="text-xs text-indigo-400 mt-1 font-mono">99.2% tasa de éxito</div>
                </div>

                <div className="p-4 rounded-xl bg-texter-surface border border-texter-border">
                  <div className="flex justify-between items-center text-xs text-texter-text-muted mb-2">
                    <span>Seguridad de Datos</span>
                    <Badge variant="success" size="sm">RLS Validado</Badge>
                  </div>
                  <div className="text-2xl font-bold font-mono text-white">Zero-Leakage</div>
                  <div className="text-xs text-texter-text-muted mt-1 font-mono">Aislamiento por usuario</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Interactive Autonomous Pipeline Demonstration */}
      <PipelineDemo />

      {/* Key Architectural Pillars */}
      <FeatureGrid />

      {/* Architecture & Infrastructure Section */}
      <section id="arquitectura" className="py-20 border-t border-texter-border/70 relative bg-texter-surface-subtle/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-3 mb-16">
            <Badge variant="cyan" size="md">
              Despliegue e Integración Oficial
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              GitHub → Vercel → Supabase → NEXTEХ
            </h2>
            <p className="text-sm sm:text-base text-texter-text-muted leading-relaxed">
              NEXTEХ es un producto de <strong className="text-white font-medium">Nexora Texter</strong>. Infraestructura completamente configurada bajo las cuentas oficiales autorizadas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card variant="elevated" padding="md" className="border-texter-border">
              <div className="text-xs font-mono text-texter-text-dim mb-1">01 / CÓDIGO</div>
              <h3 className="text-base font-bold text-white mb-1">GitHub</h3>
              <p className="text-xs text-texter-text-muted">
                Repositorio independiente con control estricto de ramas y `.env.example`.
              </p>
              <div className="mt-3 text-[11px] font-mono text-texter-indigo">
                Jordanygenao84@gmail.com
              </div>
            </Card>

            <Card variant="elevated" padding="md" className="border-texter-border">
              <div className="text-xs font-mono text-texter-text-dim mb-1">02 / HOSTING</div>
              <h3 className="text-base font-bold text-white mb-1">Vercel</h3>
              <p className="text-xs text-texter-text-muted">
                Deployments automáticos, Edge Middleware y preview branches escalables.
              </p>
              <div className="mt-3 text-[11px] font-mono text-texter-cyan">
                Jordanygenao84@gmail.com
              </div>
            </Card>

            <Card variant="elevated" padding="md" className="border-texter-border">
              <div className="text-xs font-mono text-texter-text-dim mb-1">03 / BACKEND</div>
              <h3 className="text-base font-bold text-white mb-1">Supabase</h3>
              <p className="text-xs text-texter-text-muted">
                PostgreSQL con pgvector, autenticación JWT, Row Level Security y Storage.
              </p>
              <div className="mt-3 text-[11px] font-mono text-texter-emerald">
                Jordanygenao84@gmail.com
              </div>
            </Card>

            <Card variant="elevated" padding="md" className="border-texter-indigo/40 shadow-texter-glow-indigo">
              <div className="text-xs font-mono text-texter-text-dim mb-1">04 / PRODUCTO</div>
              <h3 className="text-base font-bold text-white mb-1">NEXTEХ</h3>
              <p className="text-xs text-texter-text-muted">
                Plataforma autónoma desarrollada por Nexora Texter para tareas a escala.
              </p>
              <div className="mt-3 text-[11px] font-mono text-white">
                Producción Fase 1
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
