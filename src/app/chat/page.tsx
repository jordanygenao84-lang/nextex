"use client";

import React, { useState, useRef } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { useAuth } from "@/context/AuthContext";
import { ChatMessage as ChatMessageType } from "@/lib/mock-data";
import { CANONICAL_MODELS } from "@/lib/omniengine/registry/models";
import { Bot, AlertCircle, XCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

// Preferencia de interfaz: solo el id del modelo (sin claves ni secretos).
// Se valida contra el registro canónico para ignorar ids obsoletos.
const CHAT_MODEL_STORAGE_KEY = "nextex-chat-model";
const DEFAULT_MODEL_ID = "nextex-simulation";

export default function ChatPage() {
  const { workspace } = useAuth();
  // El chat arranca vacío: antes venía precargado con una conversación de
  // muestra y una lista de sesiones falsas que al pulsarlas no cambiaban
  // el contenido. El historial de sesiones aún no se guarda.
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  // El último modelo elegido persiste en localStorage y se restaura al
  // volver: antes el estado nacía siempre con el valor por defecto y la
  // selección volvía a "Sandbox Simulator" al salir y entrar.
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    try {
      const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
      if (stored && CANONICAL_MODELS.some((m) => m.id === stored)) return stored;
    } catch {}
    return DEFAULT_MODEL_ID;
  });

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    try {
      window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, modelId);
    } catch {}
  };
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    setErrorMessage(null);
    const userMsg: ChatMessageType = {
      id: `msg-${Date.now()}`,
      sender: "user",
      timestamp: "Ahora",
      content: text,
    };

    const assistantMsgId = `msg-${Date.now() + 1}`;
    const initialAssistantMsg: ChatMessageType = {
      id: assistantMsgId,
      sender: "assistant",
      timestamp: "Ahora",
      model: selectedModelId,
      content: "",
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    await runGeneration([...messages, userMsg], assistantMsgId);
  };

  // Regenerar reemplaza la respuesta en su sitio: recorta la conversación
  // hasta el mensaje del usuario y genera una respuesta nueva ahí, en vez
  // de añadir un turno duplicado (usuario + respuesta) al final.
  const handleRegenerate = async (assistantId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx === -1) return;
    const kept = messages.slice(0, idx);
    const prevUser = [...kept].reverse().find((m) => m.sender === "user");
    if (!prevUser) return;
    setErrorMessage(null);
    const assistantMsgId = `msg-${Date.now()}`;
    const initialAssistantMsg: ChatMessageType = {
      id: assistantMsgId,
      sender: "assistant",
      timestamp: "Ahora",
      model: selectedModelId,
      content: "",
    };
    setMessages([...kept, initialAssistantMsg]);
    await runGeneration(kept, assistantMsgId);
  };

  // Generación compartida por enviar y regenerar: el historial ya incluye
  // el mensaje del usuario al final; solo se rellena el mensaje del
  // asistente indicado.
  const runGeneration = async (
    historyMessages: ChatMessageType[],
    assistantMsgId: string
  ) => {
    setIsGenerating(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Formatear historial para el AI Gateway
      const payloadMessages = historyMessages.map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.content,
      }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          model: selectedModelId,
          messages: payloadMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData?.error?.message || `Error del servidor (${res.status})`;
        throw new Error(msg);
      }

      if (!res.body) {
        throw new Error("No se recibió flujo de datos en el cuerpo de la respuesta.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.replace(/^data: /, "").trim();

          if (dataStr === "[DONE]") break;

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (parsed.error) {
            throw new Error(parsed.error.message || "Error devuelto por el gateway de IA.");
          }

          if (parsed.delta) {
            accumulatedContent += parsed.delta;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? { ...msg, content: accumulatedContent }
                  : msg
              )
            );
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content:
                    (msg.content ? msg.content + "\n\n" : "") +
                    "[Generación detenida por el usuario]",
                }
              : msg
          )
        );
      } else {
        const errMsg = err?.message || "Ocurrió un error al procesar la respuesta.";
        setErrorMessage(errMsg);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: errMsg,
                }
              : msg
          )
        );
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleNewChat = () => {
    handleCancelGeneration();
    setErrorMessage(null);
    setMessages([
      {
        id: `msg-${Date.now()}`,
        sender: "assistant",
        timestamp: "Ahora",
        model: selectedModelId,
        content: "Espacio de trabajo listo. ¿Qué tarea o pipeline deseas que ejecute?",
      },
    ]);
  };

  return (
    <DashboardShell
      title="Espacio de Trabajo con Agentes IA"
      subtitle="Orquestación autónoma, ejecución de tareas y trazabilidad de pipelines"
    >
      <div className="h-[calc(100vh-8.5rem)] flex rounded-2xl border border-texter-border bg-texter-surface overflow-hidden shadow-2xl nextex-grid-bg">
        {/* Chat History Sidebar */}
        <div className="hidden md:block h-full">
          <ChatSidebar
            onNewChat={handleNewChat}
          />
        </div>

        {/* Main Conversation & Execution Canvas */}
        <div className="flex-1 flex flex-col h-full bg-texter-surface-subtle/30 overflow-hidden">
          {/* Top Bar of Session */}
          <div className="h-14 px-4 border-b border-texter-border flex items-center justify-between bg-texter-surface/70 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-texter-emerald animate-pulse" />
              <span className="text-xs font-bold text-white font-mono hidden sm:inline">
                NEXTEХ OmniEngine
              </span>
              <Badge variant="cyan" size="sm">
                Gateway v1.0
              </Badge>
            </div>

            {/* Model Registry Selector en el Top Bar */}
            <div className="flex items-center gap-2">
              {isGenerating && (
                <button
                  type="button"
                  onClick={handleCancelGeneration}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-texter-rose/10 hover:bg-texter-rose/20 text-texter-rose text-xs font-mono border border-rose-500/30 transition-all"
                  title="Detener generación actual"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Detener</span>
                </button>
              )}
              <ModelSelector
                selectedModelId={selectedModelId}
                onSelectModel={handleSelectModel}
              />
            </div>
          </div>

          {/* Error Banner si el gateway reporta algo */}
          {errorMessage && (
            <div className="p-3 mx-4 mt-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-texter-text-muted hover:text-white"
                aria-label="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.length === 0 && !isGenerating && (
              <div className="text-center py-16 space-y-2">
                <p className="text-sm font-semibold text-white">
                  Espacio de trabajo listo.
                </p>
                <p className="text-xs text-texter-text-muted">
                  Escribe abajo qué tarea o pipeline deseas que ejecute.
                </p>
              </div>
            )}
            {messages.map((message, index) => {
              // Regenerar reemplaza esta respuesta en su sitio. Sin
              // usuario previo no hay nada que regenerar y el botón
              // queda deshabilitado.
              const prevUser = [...messages.slice(0, index)]
                .reverse()
                .find((m) => m.sender === "user");
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onRegenerate={
                    message.sender === "assistant" && prevUser && !isGenerating
                      ? () => handleRegenerate(message.id)
                      : undefined
                  }
                />
              );
            })}

            {isGenerating && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-texter-surface border border-texter-border/60 animate-pulse">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-texter-indigo to-texter-cyan flex items-center justify-center text-white">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-white flex items-center gap-2">
                    NEXTEХ OmniEngine está generando respuesta...
                    <span className="text-texter-cyan text-[11px] font-mono">
                      (Streaming activo)
                    </span>
                  </p>
                  <p className="text-[11px] text-texter-text-muted font-mono">
                    Canalizando tokens por el AI Gateway de forma segura
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
