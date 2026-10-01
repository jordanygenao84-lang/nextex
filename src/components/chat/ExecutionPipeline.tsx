import React, { useState } from "react";
import { ExecutionStep } from "@/lib/mock-data";
import {
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

interface ExecutionPipelineProps {
  intent: string;
  steps: ExecutionStep[];
  toolsTriggered: string[];
  resultSummary?: string;
}

export const ExecutionPipeline: React.FC<ExecutionPipelineProps> = ({
  intent,
  steps,
  toolsTriggered,
  resultSummary,
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-2xl bg-texter-surface-subtle/80 border border-texter-border overflow-hidden my-3">
      {/* Header bar with toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3.5 flex items-center justify-between hover:bg-texter-surface-hover/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-texter-indigo/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Cpu className="w-3.5 h-3.5 text-texter-indigo" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Pipeline de Ejecución Autónomo
              </span>
              <Badge variant="cyan" size="sm" dot>
                {steps.length} Pasos Completados
              </Badge>
            </div>
            <p className="text-[11px] text-texter-text-muted truncate mt-0.5">
              Objetivo: {intent}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {toolsTriggered.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {toolsTriggered.map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-texter-surface border border-texter-border text-texter-cyan"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-texter-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-texter-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded Pipeline Details */}
      {expanded && (
        <div className="p-4 border-t border-texter-border/60 bg-texter-surface/40 space-y-4">
          {/* Step Sequence Timeline */}
          <div className="space-y-3">
            {steps.map((st, idx) => (
              <div key={st.step} className="flex items-start gap-3 relative">
                {/* Connecting Line */}
                {idx < steps.length - 1 && (
                  <div className="absolute left-3 top-6 bottom-0 w-0.5 bg-texter-border -mb-3" />
                )}

                {/* Status Dot */}
                <div className="w-6 h-6 rounded-full bg-texter-emerald/15 border border-emerald-500/40 flex items-center justify-center shrink-0 z-10">
                  <CheckCircle2 className="w-3.5 h-3.5 text-texter-emerald" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">
                      Paso {st.step}: {st.title}
                    </span>
                    {st.duration && (
                      <span className="text-[10px] font-mono text-texter-cyan flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {st.duration}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-texter-text-secondary mt-0.5">
                    {st.description}
                  </p>
                  {st.toolUsed && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Terminal className="w-3 h-3 text-texter-text-dim" />
                      <code className="text-[10px] font-mono text-texter-cyan bg-texter-surface px-1.5 py-0.5 rounded border border-texter-border">
                        {st.toolUsed}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Outcome Summary */}
          {resultSummary && (
            <div className="p-3 rounded-xl bg-texter-indigo/10 border border-indigo-500/20 text-xs text-indigo-200 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-texter-indigo shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold text-white">Síntesis Operativa: </strong>
                {resultSummary}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
