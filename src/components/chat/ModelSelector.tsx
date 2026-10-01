"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, Cpu, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { ModelMetadata } from "@/lib/omniengine/types";
import { CANONICAL_MODELS } from "@/lib/omniengine/registry/models";
import { Badge } from "@/components/ui/Badge";

interface ModelSelectorProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  className?: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModelId,
  onSelectModel,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<ModelMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch("/api/ai/models");
        if (res.ok) {
          const json = await res.json();
          setModels(json.models || []);
        } else {
          // Fallback seguro a catálogo local sin secretos
          setModels(
            CANONICAL_MODELS.map((m) => ({
              ...m,
              status: m.provider === "local_mock" ? "available" : "unconfigured",
            }))
          );
        }
      } catch {
        setModels(
          CANONICAL_MODELS.map((m) => ({
            ...m,
            status: m.provider === "local_mock" ? "available" : "unconfigured",
          }))
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchModels();
  }, []);

  const currentModel = models.find((m) => m.id === selectedModelId) || models[0];

  return (
    <div className={`relative ${className}`}>
      {/* Selector Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-texter-surface-subtle hover:bg-texter-surface-hover border border-texter-border text-xs text-white transition-all shadow-sm"
        title="Seleccionar modelo de inteligencia artificial"
      >
        <Cpu className="w-3.5 h-3.5 text-texter-cyan shrink-0" />
        <span className="font-semibold truncate max-w-[130px] sm:max-w-[160px]">
          {currentModel ? currentModel.displayName : "Cargando..."}
        </span>

        {currentModel?.status === "available" ? (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        ) : (
          <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
            No configurado
          </span>
        )}

        <ChevronDown
          className={`w-3.5 h-3.5 text-texter-text-muted transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-texter-surface border border-texter-border shadow-2xl p-2 z-50 space-y-1 backdrop-blur-xl">
            <div className="px-3 py-2 border-b border-texter-border/50 text-[11px] font-mono text-texter-text-dim flex items-center justify-between">
              <span>MODEL REGISTRY CANÓNICO</span>
              <span>{models.length} MODELOS</span>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1 pt-1">
              {models.map((model) => {
                const isConfigured = model.status === "available";
                const isSelected = model.id === selectedModelId;

                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      if (isConfigured) {
                        onSelectModel(model.id);
                        setIsOpen(false);
                      }
                    }}
                    disabled={!isConfigured}
                    className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start justify-between gap-2 border ${
                      isSelected
                        ? "bg-texter-indigo/15 border-indigo-500/40 text-white"
                        : isConfigured
                        ? "hover:bg-texter-surface-hover border-transparent text-texter-text-secondary hover:text-white"
                        : "opacity-60 cursor-not-allowed border-transparent text-texter-text-muted bg-texter-surface-subtle/30"
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white">{model.displayName}</span>
                        <span className="text-[10px] text-texter-text-dim font-mono uppercase">
                          ({model.provider})
                        </span>
                      </div>
                      <p className="text-[10px] text-texter-text-dim">
                        Contexto: {(model.contextWindow / 1024).toFixed(0)}k tokens •{" "}
                        {model.supportsVision ? "Visión" : "Texto"}
                      </p>
                    </div>

                    <div className="shrink-0 mt-0.5">
                      {isConfigured ? (
                        <CheckCircle2
                          className={`w-3.5 h-3.5 ${
                            isSelected ? "text-texter-cyan" : "text-emerald-400"
                          }`}
                        />
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono flex items-center gap-1">
                          <AlertCircle className="w-2.5 h-2.5" />
                          No configurado
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
