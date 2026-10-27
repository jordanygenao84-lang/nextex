"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  onNewChat: () => void;
  className?: string;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
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

      {/* Historial: aún no se guarda. Antes esta lista mostraba sesiones
          de muestra que al pulsarlas no cambiaban la conversación. */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <p className="px-2 py-1.5 text-[10px] font-semibold text-texter-text-dim uppercase tracking-wider font-mono">
          Sesiones Recientes
        </p>
        <p className="px-2 py-2 text-xs text-texter-text-muted leading-relaxed">
          El historial de sesiones aún no se guarda en este chat. Cada
          conversación empieza vacía con "Nueva Tarea / Chat".
        </p>
      </div>
    </div>
  );
};
