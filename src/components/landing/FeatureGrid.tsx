import React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  Layers,
  ShieldCheck,
  Zap,
  Cpu,
  Workflow,
  Lock,
  ArrowRight,
  Database,
} from "lucide-react";

export const FeatureGrid: React.FC = () => {
  const features = [
    {
      title: "Inferencia Multi-Modelo Dinámica",
      desc: "Conecta Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro o modelos de código según la complejidad y costo de cada tarea.",
      icon: Cpu,
      color: "text-texter-indigo",
      border: "hover:border-indigo-500/40",
      badge: "Flexible",
    },
    {
      title: "Orquestación de Agentes y Herramientas",
      desc: "Descompone instrucciones en grafos de tareas autónomas con invocación segura de APIs, cálculos matemáticos y OCR.",
      icon: Workflow,
      color: "text-texter-cyan",
      border: "hover:border-cyan-500/40",
      badge: "Autónomo",
    },
    {
      title: "Seguridad RLS y Aislamiento Estricto",
      desc: "Supabase Row Level Security a nivel de base de datos. Ningún usuario puede acceder ni inferir datos de otros inquilinos.",
      icon: ShieldCheck,
      color: "text-texter-emerald",
      border: "hover:border-emerald-500/40",
      badge: "Zero-Trust",
    },
    {
      title: "Telemetría y Control de Tokens",
      desc: "Supervisión detallada de latencias p95, consumo de cuota, costos por inferencia y registros inmutables de auditoría.",
      icon: Zap,
      color: "text-texter-amber",
      border: "hover:border-amber-500/40",
      badge: "Tiempo Real",
    },
    {
      title: "Jobs en Segundo Plano y Automatizaciones",
      desc: "Ejecución desatendida de tareas de sincronización, ingesta documental y generación periódica de informes ejecutivos.",
      icon: Layers,
      color: "text-purple-400",
      border: "hover:border-purple-500/40",
      badge: "Escalable",
    },
    {
      title: "Despliegue Global en Vercel Edge",
      desc: "Arquitectura Serverless optimizada con streaming WebSockets de baja latencia y disponibilidad global sin interrupciones.",
      icon: Database,
      color: "text-cyan-400",
      border: "hover:border-cyan-500/40",
      badge: "Global Edge",
    },
  ];

  return (
    <section id="capacidades" className="py-20 border-t border-texter-border/70 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-16">
          <Badge variant="indigo" size="md">
            Arquitectura de Alto Nivel
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Diseñado para escalar sin deuda técnica
          </h2>
          <p className="text-sm sm:text-base text-texter-text-muted leading-relaxed">
            Cada componente de NEXTEХ está desacoplado para permitir que la plataforma crezca hacia miles de usuarios concurrentes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <Card
                key={feat.title}
                variant="elevated"
                padding="lg"
                className={`transition-all duration-300 ${feat.border}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border">
                    <Icon className={`w-5 h-5 ${feat.color}`} />
                  </div>
                  <Badge variant="outline" size="sm">
                    {feat.badge}
                  </Badge>
                </div>
                <h3 className="text-base font-bold text-white mb-2 tracking-tight">
                  {feat.title}
                </h3>
                <p className="text-xs sm:text-sm text-texter-text-muted leading-relaxed">
                  {feat.desc}
                </p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};
