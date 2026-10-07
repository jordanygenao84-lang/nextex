import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { MessageSquarePlus, Sparkles, Workflow, ShieldAlert, ArrowRight } from "lucide-react";

export const QuickActions: React.FC = () => {
  const actions = [
    {
      title: "Nueva Sesión con Agente",
      desc: "Inicia un chat avanzado con orquestación autónoma",
      href: "/chat",
      icon: MessageSquarePlus,
      color: "text-texter-indigo",
      border: "hover:border-indigo-500/40",
    },
    {
      title: "Diseñar Pipeline de Automatización",
      desc: "Conecta fuentes de datos, triggers y modelos de IA",
      href: "/automations",
      icon: Workflow,
      color: "text-texter-cyan",
      border: "hover:border-cyan-500/40",
    },
    {
      title: "Auditoría de Políticas de Supabase",
      desc: "Verifica permisos RBAC y aislamiento de datos por usuario",
      href: "/control-plane/audit",
      icon: ShieldAlert,
      color: "text-texter-emerald",
      border: "hover:border-emerald-500/40",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {actions.map((act) => {
        const Icon = act.icon;
        return (
          <Link key={act.title} href={act.href} className="group block">
            <Card
              variant="interactive"
              padding="md"
              className={`h-full flex flex-col justify-between ${act.border}`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
                    <Icon className={`w-5 h-5 ${act.color}`} />
                  </div>
                  <ArrowRight className="w-4 h-4 text-texter-text-dim group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white group-hover:text-texter-indigo transition-colors">
                    {act.title}
                  </h4>
                  <p className="text-xs text-texter-text-muted mt-1 leading-relaxed">
                    {act.desc}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
};
