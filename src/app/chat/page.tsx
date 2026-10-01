"use client";

import React, { useState } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { MOCK_CHAT_MESSAGES, ChatMessage as ChatMessageType } from "@/lib/mock-data";
import { Sparkles, Terminal, Shield, ArrowRight, Bot } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessageType[]>(MOCK_CHAT_MESSAGES);
  const [activeSessionId, setActiveSessionId] = useState("chat-1");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showHistoryMobile, setShowHistoryMobile] = useState(false);

  const handleSendMessage = (text: string) => {
    const userMsg: ChatMessageType = {
      id: `msg-${Date.now()}`,
      sender: "user",
      timestamp: "Ahora",
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    // Simulate autonomous execution pipeline & response
    setTimeout(() => {
      const assistantMsg: ChatMessageType = {
        id: `msg-${Date.now() + 1}`,
        sender: "assistant",
        timestamp: "Ahora",
        model: "NEXTEХ OmniEngine v1 (Multi-Model)",
        content: `He recibido tu instrucción: "${text}".\n\nEl orquestador de agentes ha ejecutado el plan de análisis, verificando la consistencia de los datos y asegurando el aislamiento por inquilino en Supabase con políticas RLS activas.\n\nTodo el flujo se ha completado de forma satisfactoria sin alertas de seguridad.`,
        pipeline: {
          intent: text,
          steps: [
            {
              step: 1,
              title: "Planificación del Grafo de Tareas",
              status: "completed",
              description: "Extracción de entidades y definición de restricciones operativas.",
              duration: "120ms",
            },
            {
              step: 2,
              title: "Ejecución en Sandbox Aislado",
              status: "completed",
              description: "Procesamiento de scripts en Edge Runtime con RLS.",
              duration: "450ms",
              toolUsed: "runtime_task_executor()",
            },
            {
              step: 3,
              title: "Validación de Resultados",
              status: "completed",
              description: "Confirmación de no regresión y verificación de integridad.",
              duration: "95ms",
            },
          ],
          toolsTriggered: ["runtime_task_executor", "supabase_audit_gate"],
          resultSummary: "Operación autónoma validada con 100% de éxito.",
        },
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsGenerating(false);
    }, 1800);
  };

  const handleNewChat = () => {
    setMessages([
      {
        id: `msg-${Date.now()}`,
        sender: "assistant",
        timestamp: "Ahora",
        model: "NEXTEХ OmniEngine v1",
        content: "Espacio de trabajo listo. ¿Qué tarea o pipeline deseas que ejecute hoy?",
      },
    ]);
  };

  return (
    <DashboardShell
      title="Espacio de Trabajo con Agentes IA"
      subtitle="Orquestación autónoma, ejecución de tareas y trazabilidad de pipelines"
    >
      <div className="h-[calc(100vh-8.5rem)] flex rounded-2xl border border-texter-border bg-texter-surface overflow-hidden shadow-2xl">
        {/* Chat History Sidebar */}
        <div className="hidden md:block h-full">
          <ChatSidebar
            activeSessionId={activeSessionId}
            onSelectSession={setActiveSessionId}
            onNewChat={handleNewChat}
          />
        </div>

        {/* Main Conversation & Execution Canvas */}
        <div className="flex-1 flex flex-col h-full bg-texter-surface-subtle/30 overflow-hidden">
          {/* Top Bar of Session */}
          <div className="h-12 px-4 border-b border-texter-border flex items-center justify-between bg-texter-surface/70 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-texter-emerald animate-pulse" />
              <span className="text-xs font-bold text-white font-mono">
                Sesión: Auditoría de Políticas RLS y Permisos
              </span>
              <Badge variant="cyan" size="sm">
                Edge v1.4
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-texter-text-muted">
              <span className="hidden sm:inline font-mono">Tokens: 14.8k / 128k</span>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isGenerating && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-texter-surface border border-texter-border/60 animate-pulse">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-texter-indigo to-texter-cyan flex items-center justify-center text-white">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-white flex items-center gap-2">
                    NEXTEХ Agent está orquestando herramientas...
                    <span className="text-texter-cyan text-[11px] font-mono">
                      (Análisis en curso)
                    </span>
                  </p>
                  <p className="text-[11px] text-texter-text-muted">
                    Evaluando esquema de datos y ejecutando plan de tareas
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Prompt Input Area */}
          <div className="p-3 sm:p-4 bg-texter-surface/90 border-t border-texter-border shrink-0">
            <ChatInput onSendMessage={handleSendMessage} isLoading={isGenerating} />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
