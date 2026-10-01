"use client";

import React, { useState } from "react";
import {
  Menu,
  Bell,
  Search,
  ChevronDown,
  Sparkles,
  Command,
  Database,
  Cloud,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface HeaderProps {
  onOpenMobile?: () => void;
  title?: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobile,
  title = "Panel de Control",
  subtitle = "Infraestructura autónoma activa",
}) => {
  const [selectedModel, setSelectedModel] = useState("NEXTEХ OmniEngine v1");
  const [showModelMenu, setShowModelMenu] = useState(false);

  const models = [
    { name: "NEXTEХ OmniEngine v1", badge: "Recomendado", desc: "Orquestador de agentes y tareas" },
    { name: "Claude 3.5 Sonnet", badge: "Razonamiento", desc: "Análisis profundo de código y documentos" },
    { name: "GPT-4o Omnimodal", badge: "Velocidad", desc: "Generación multimodal y respuestas rápidas" },
    { name: "Gemini 1.5 Pro", badge: "Contexto 2M", desc: "Procesamiento masivo de repositorios" },
  ];

  return (
    <header className="h-16 bg-texter-surface/80 backdrop-blur-md border-b border-texter-border sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
      {/* Left: Mobile trigger & Page Info */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobile}
          className="p-2 text-texter-text-secondary hover:text-white rounded-xl hover:bg-texter-surface-hover lg:hidden border border-texter-border"
          aria-label="Abrir navegación"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex flex-col">
          <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            {title}
            <Badge variant="cyan" size="sm" dot>
              Sincronizado
            </Badge>
          </h1>
          <p className="text-[11px] text-texter-text-muted">{subtitle}</p>
        </div>
      </div>

      {/* Center: Search / Command hint */}
      <div className="hidden md:flex items-center">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-texter-text-muted hover:border-texter-border-hover transition-colors cursor-pointer w-64 justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-texter-text-dim" />
            <span>Buscar pipelines, tareas o agentes...</span>
          </div>
          <kbd className="px-1.5 py-0.5 rounded bg-texter-surface text-[10px] font-mono text-texter-text-dim border border-texter-border">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: Model Selector & Connectivity Indicators */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Model Selector Pill */}
        <div className="relative">
          <button
            onClick={() => setShowModelMenu(!showModelMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border hover:border-texter-border-hover transition-all text-xs font-medium text-texter-text-primary"
          >
            <Sparkles className="w-3.5 h-3.5 text-texter-indigo" />
            <span className="hidden sm:inline font-mono">{selectedModel}</span>
            <span className="sm:hidden font-mono">OmniEngine</span>
            <ChevronDown className="w-3.5 h-3.5 text-texter-text-muted" />
          </button>

          {showModelMenu && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-texter-surface border border-texter-border shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-2 border-b border-texter-border/50 text-[11px] font-semibold text-texter-text-muted uppercase font-mono">
                Selector de Modelo de Inferencia
              </div>
              <div className="space-y-1 mt-1">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => {
                      setSelectedModel(m.name);
                      setShowModelMenu(false);
                    }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-texter-surface-hover flex flex-col gap-0.5 transition-colors group"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-white group-hover:text-texter-indigo">
                        {m.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-texter-surface-subtle border border-texter-border text-texter-text-muted">
                        {m.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-texter-text-muted leading-tight">
                      {m.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Supabase & Vercel status icons */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-texter-text-muted">
          <span title="Supabase DB Conectada" className="flex items-center">
            <Database className="w-3.5 h-3.5 text-texter-emerald" />
          </span>
          <span className="text-[11px] font-mono text-texter-text-secondary">Supabase</span>
          <span className="w-1 h-1 rounded-full bg-texter-border mx-1" />
          <span title="Vercel Edge Ready" className="flex items-center">
            <Cloud className="w-3.5 h-3.5 text-texter-cyan" />
          </span>
          <span className="text-[11px] font-mono text-texter-text-secondary">Vercel</span>
        </div>

        {/* Notifications */}
        <button
          className="p-2 text-texter-text-secondary hover:text-white rounded-xl hover:bg-texter-surface-hover border border-texter-border relative"
          aria-label="Notificaciones"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-texter-indigo animate-pulse" />
        </button>
      </div>
    </header>
  );
};
