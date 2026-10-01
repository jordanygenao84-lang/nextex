"use client";

import React from "react";
import { Plus, MessageSquare, Search, Trash2, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MOCK_SESSIONS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  className?: string;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  activeSessionId,
  onSelectSession,
  onNewChat,
  className,
}) => {
  return (
    <div
      className={cn(
        "w-full lg:w-72 bg-texter-surface border-r border-texter-border flex flex-col h-full",
        className
      )}
    >
      {/* New Chat Button */}
      <div className="p-3 border-b border-texter-border">
        <Button
          onClick={onNewChat}
          variant="primary"
          size="md"
          className="w-full justify-center"
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Nueva Tarea / Chat
        </Button>
      </div>

      {/* Search Sessions */}
      <div className="p-3 border-b border-texter-border">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-texter-text-muted absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Buscar historial..."
            className="w-full bg-texter-surface-subtle text-xs text-white placeholder:text-texter-text-dim rounded-xl border border-texter-border pl-8 pr-3 py-2 outline-none focus:border-texter-indigo"
          />
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <p className="px-2 py-1.5 text-[10px] font-semibold text-texter-text-dim uppercase tracking-wider font-mono">
          Sesiones Recientes
        </p>
        {MOCK_SESSIONS.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "w-full text-left p-2.5 rounded-xl transition-all flex flex-col gap-1 group border",
                isActive
                  ? "bg-texter-indigo/15 border-indigo-500/30 text-white"
                  : "bg-transparent border-transparent hover:bg-texter-surface-hover hover:border-texter-border text-texter-text-secondary hover:text-white"
              )}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="text-xs font-semibold truncate group-hover:text-texter-indigo transition-colors">
                  {session.title}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-texter-text-muted font-mono">
                <span className="truncate text-texter-cyan">
                  {session.agent}
                </span>
                <span className="text-texter-text-dim shrink-0">
                  {session.updatedAt}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer / Quota */}
      <div className="p-3 border-t border-texter-border bg-texter-surface-subtle/50 text-xs text-texter-text-muted">
        <div className="flex justify-between items-center mb-1.5">
          <span className="font-mono text-[11px]">Cuota de Inferencia</span>
          <span className="font-mono text-[11px] text-emerald-400">82% libre</span>
        </div>
        <div className="w-full h-1.5 bg-texter-surface rounded-full overflow-hidden border border-texter-border">
          <div className="h-full bg-gradient-to-r from-texter-indigo to-texter-cyan w-[18%]" />
        </div>
      </div>
    </div>
  );
};
