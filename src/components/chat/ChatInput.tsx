"use client";

import React, { useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Globe,
  Database,
  Terminal,
  Sparkles,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
}) => {
  const [input, setInput] = useState("");
  const [toolsActive, setToolsActive] = useState({
    webSearch: true,
    supabase: true,
    codeInterpreter: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 sm:p-4 rounded-2xl bg-texter-surface border border-texter-border shadow-2xl focus-within:border-texter-indigo focus-within:ring-2 focus-within:ring-texter-indigo/20 transition-all"
    >
      {/* Text Area */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Instruye al agente de NEXTEХ... (ej: 'Analiza los últimos balances y optimiza las políticas RLS')"
        rows={2}
        className="w-full bg-transparent text-sm text-texter-text-primary placeholder:text-texter-text-dim outline-none resize-none leading-relaxed"
      />

      {/* Capabilities Toolbar & Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-texter-border/50 mt-1">
        {/* Active Tools Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() =>
              setToolsActive((prev) => ({ ...prev, webSearch: !prev.webSearch }))
            }
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all border",
              toolsActive.webSearch
                ? "bg-texter-cyan/15 text-cyan-300 border-cyan-500/30"
                : "bg-texter-surface-subtle text-texter-text-dim border-texter-border hover:text-texter-text-muted"
            )}
          >
            <Globe className="w-3 h-3" />
            <span>Web Search</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setToolsActive((prev) => ({ ...prev, supabase: !prev.supabase }))
            }
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all border",
              toolsActive.supabase
                ? "bg-texter-emerald/15 text-emerald-300 border-emerald-500/30"
                : "bg-texter-surface-subtle text-texter-text-dim border-texter-border hover:text-texter-text-muted"
            )}
          >
            <Database className="w-3 h-3" />
            <span>Supabase RLS</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setToolsActive((prev) => ({
                ...prev,
                codeInterpreter: !prev.codeInterpreter,
              }))
            }
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all border",
              toolsActive.codeInterpreter
                ? "bg-texter-indigo/15 text-indigo-300 border-indigo-500/30"
                : "bg-texter-surface-subtle text-texter-text-dim border-texter-border hover:text-texter-text-muted"
            )}
          >
            <Terminal className="w-3 h-3" />
            <span>Code Execution</span>
          </button>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="p-2 text-texter-text-muted hover:text-white rounded-xl hover:bg-texter-surface-hover border border-texter-border transition-colors"
            title="Adjuntar documento o dataset"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={!input.trim() || isLoading}
            isLoading={isLoading}
            className="rounded-xl px-3.5 h-9"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </form>
  );
};
