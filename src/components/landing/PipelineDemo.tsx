"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  MessageSquare,
  Search,
  Wrench,
  Cpu,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Terminal,
  Play,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const PipelineDemo: React.FC = () => {
  const [activeStep, setActiveStep] = useState(3);

  const steps = [
    {
      index: 1,
      name: "1. Entrada",
      title: "Instrucción de Usuario",
      desc: "“Analiza estos datos de ventas, detecta anomalías y prepara un informe ejecutivo.”",
      icon: MessageSquare,
      color: "text-texter-indigo",
      bg: "bg-texter-indigo/10",
      border: "border-indigo-500/30",
    },
    {
      index: 2,
      name: "2. Análisis",
      title: "Descomposición Semántica",
      desc: "El orquestador divide la instrucción en 3 objetivos matemáticos y planifica herramientas.",
      icon: Search,
      color: "text-texter-cyan",
      bg: "bg-texter-cyan/10",
      border: "border-cyan-500/30",
    },
    {
      index: 3,
      name: "3. Herramientas",
      title: "Invocación de Tool Calling",
      desc: "Dispara `supabase_sales_query()`, `anomaly_detector()` y `stat_model_v2()`.",
      icon: Wrench,
      color: "text-texter-amber",
      bg: "bg-texter-amber/10",
      border: "border-amber-500/30",
    },
    {
      index: 4,
      name: "4. Ejecución",
      title: "Procesamiento Concurrente",
      desc: "Sandbox de ejecución aislado en Edge Runtime con políticas RLS de Supabase.",
      icon: Cpu,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/30",
    },
    {
      index: 5,
      name: "5. Resultado",
      title: "Artefacto & Síntesis",
      desc: "Informe ejecutivo generado con tabla comparativa, insights de margen y archivo exportable.",
      icon: CheckCircle2,
      color: "text-texter-emerald",
      bg: "bg-texter-emerald/10",
      border: "border-emerald-500/30",
    },
  ];

  return (
    <section id="pipeline" className="py-20 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-12">
          <Badge variant="cyan" size="md" dot>
            Paradigma de IA Autónoma
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Más que un chatbot: un motor de ejecución de tareas
          </h2>
          <p className="text-sm sm:text-base text-texter-text-muted leading-relaxed">
            NEXTEХ no se limita a responder preguntas con texto plano. Conecta modelos de IA con herramientas reales, bases de datos y pipelines de ejecución.
          </p>
        </div>

        {/* Interactive Stepper Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-8">
          {steps.map((st) => {
            const isSelected = activeStep === st.index;
            const Icon = st.icon;
            return (
              <button
                key={st.index}
                onClick={() => setActiveStep(st.index)}
                className={cn(
                  "p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5",
                  isSelected
                    ? "bg-texter-surface border-texter-indigo shadow-texter-glow-indigo text-white"
                    : "bg-texter-surface-subtle border-texter-border text-texter-text-muted hover:border-texter-border-hover"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
                    {st.name}
                  </span>
                  <Icon className={cn("w-3.5 h-3.5", isSelected ? st.color : "text-texter-text-dim")} />
                </div>
                <span className="text-xs font-semibold truncate text-white">
                  {st.title}
                </span>
              </button>
            );
          })}
        </div>

        {/* Live Visualizer Stage */}
        <Card variant="elevated" padding="lg" className="border-texter-border/90 shadow-2xl">
          <div className="flex flex-col lg:flex-row items-stretch gap-6">
            {/* Left: Active Step Inspector */}
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-texter-cyan">
                  ETAPA {activeStep} DE 5
                </span>
                <span className="text-texter-border">•</span>
                <span className="text-xs font-mono text-emerald-400">
                  LATENCIA: 320ms
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {steps[activeStep - 1].title}
              </h3>

              <p className="text-sm text-texter-text-secondary leading-relaxed">
                {steps[activeStep - 1].desc}
              </p>

              {/* Console Simulation Box */}
              <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border font-mono text-xs space-y-2 text-texter-text-muted">
                <div className="flex items-center justify-between pb-2 border-b border-texter-border/50 text-texter-text-dim text-[11px]">
                  <span>NEXTEX_TRACE_ID: #nx-88192-alpha</span>
                  <span className="text-texter-emerald">STATUS: OK</span>
                </div>
                <p className="text-texter-indigo">
                  &gt; orquestador.evaluar(payload, aislamiento="tenant_isolation")
                </p>
                <p className="text-cyan-400">
                  &gt; herramientas_disparadas: [supabase_sales_query, anomaly_detector]
                </p>
                <p className="text-emerald-400">
                  &gt; resultado: 0 anomalías críticas, 2 sugerencias de optimización generadas.
                </p>
              </div>

              {/* Navigation inside demo */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    setActiveStep((prev) => (prev < 5 ? prev + 1 : 1))
                  }
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  {activeStep < 5 ? "Siguiente Paso" : "Reiniciar Demostración"}
                </Button>
                <span className="text-xs text-texter-text-dim">
                  Haz clic para avanzar en el pipeline
                </span>
              </div>
            </div>

            {/* Right: Flow Architecture Visualizer */}
            <div className="lg:w-96 rounded-xl bg-texter-surface-subtle p-5 border border-texter-border flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-mono text-texter-text-dim uppercase tracking-wider block mb-3">
                  Pila Tecnológica Integrada
                </span>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-texter-surface border border-texter-border text-xs">
                    <span className="font-semibold text-white">Modelos LLM</span>
                    <span className="font-mono text-texter-cyan">Claude • GPT-4o • Gemini</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-texter-surface border border-texter-border text-xs">
                    <span className="font-semibold text-white">Persistencia & RLS</span>
                    <span className="font-mono text-texter-emerald">Supabase PostgreSQL</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-texter-surface border border-texter-border text-xs">
                    <span className="font-semibold text-white">Edge Execution</span>
                    <span className="font-mono text-texter-indigo">Vercel Serverless</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-texter-surface border border-texter-border text-xs">
                    <span className="font-semibold text-white">Control de Versiones</span>
                    <span className="font-mono text-texter-text-secondary">GitHub CI/CD</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-texter-border text-[11px] text-texter-text-dim font-mono">
                Cuentas maestras asignadas a: Jordanygenao84@gmail.com
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
};
