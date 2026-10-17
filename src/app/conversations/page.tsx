"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import {
  MessageSquare,
  Bot,
  User,
  Send,
  RefreshCw,
  Search,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronLeft,
} from "lucide-react";

interface ConversationItem {
  id: string;
  client_id: string;
  client_name: string;
  channel: "widget" | "whatsapp" | "instagram" | "other";
  external_chat_id: string;
  visitor_name: string | null;
  status: "bot" | "human" | "paused";
  last_message_at: string;
  unread_count: number;
}

interface ConversationMessage {
  id: string;
  role: "visitor" | "bot" | "human_agent";
  content: string;
  created_at: string;
}

interface ClientOption {
  id: string;
  display_name: string;
}

export default function ConversationsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Estados principales
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [clients, setClients] = useState<ClientOption[]>([]);

  // Filtros
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Conversación seleccionada
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Input de envío
  const [inputContent, setInputContent] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isTogglingTakeover, setIsTogglingTakeover] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Protección de ruta
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/conversations");
    }
  }, [user, isAuthLoading, router]);

  // Cargar clientes para el filtro
  useEffect(() => {
    if (!user) return;
    async function loadClients() {
      try {
        const res = await fetch("/api/clients");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setClients(data.map((c: any) => ({ id: c.id, display_name: c.display_name })));
          }
        }
      } catch {
        // Fallback silencioso
      }
    }
    loadClients();
  }, [user]);

  // Cargar lista de conversaciones
  const loadConversations = useCallback(
    async (showLoading = false) => {
      if (showLoading) setIsLoadingList(true);
      try {
        const params = new URLSearchParams();
        if (selectedClientId !== "all") params.set("client_id", selectedClientId);
        if (selectedChannel !== "all") params.set("channel", selectedChannel);
        if (selectedStatus !== "all") params.set("status", selectedStatus);

        const url = `/api/conversations${params.toString() ? `?${params.toString()}` : ""}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setConversations(data);

            if (selectedConvId) {
              const current = data.find((c) => c.id === selectedConvId);
              if (current) {
                setSelectedConv(current);
              }
            }
          }
        }
      } catch (err: any) {
        console.error("Error al cargar conversaciones:", err);
      } finally {
        if (showLoading) setIsLoadingList(false);
      }
    },
    [selectedClientId, selectedChannel, selectedStatus, selectedConvId]
  );

  // Cargar mensajes de la conversación activa
  const loadMessages = useCallback(async (convId: string, showLoading = false) => {
    if (showLoading) setIsLoadingMessages(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.conversation) {
          setSelectedConv(data.conversation);
        }
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setActionError(errData?.error?.message || "No se pudo cargar la conversación.");
      }
    } catch (err: any) {
      setActionError(err?.message || "Error al consultar mensajes.");
    } finally {
      if (showLoading) setIsLoadingMessages(false);
    }
  }, []);

  const handleSelectConversation = (conv: ConversationItem) => {
    setSelectedConvId(conv.id);
    setSelectedConv(conv);
    loadMessages(conv.id, true);
  };

  useEffect(() => {
    if (user) {
      loadConversations(true);
    }
  }, [user, loadConversations]);

  // Polling en vivo cada 5 segundos
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      loadConversations(false);
      if (selectedConvId) {
        loadMessages(selectedConvId, false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [user, loadConversations, loadMessages, selectedConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 1. Takeover (Tomar control humano)
  const handleTakeover = async () => {
    if (!selectedConvId) return;
    setIsTogglingTakeover(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConvId}/takeover`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setActionError(data?.error?.message || "Error al tomar control.");
        return;
      }

      setSelectedConv(data);
      setConversations((prev) =>
        prev.map((c) => (c.id === data.id ? { ...c, status: "human" } : c))
      );
      setFeedback({ type: "success", message: "Control humano activado. Ahora puedes responder directamente." });
    } catch (err: any) {
      setActionError(err?.message || "Error de red al activar takeover.");
    } finally {
      setIsTogglingTakeover(false);
    }
  };

  // 2. Release (Devolver al bot)
  const handleRelease = async () => {
    if (!selectedConvId) return;
    setIsTogglingTakeover(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConvId}/release`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setActionError(data?.error?.message || "Error al devolver al bot.");
        return;
      }

      setSelectedConv(data);
      setConversations((prev) =>
        prev.map((c) => (c.id === data.id ? { ...c, status: "bot" } : c))
      );
      setFeedback({ type: "success", message: "Control devuelto al agente bot." });
    } catch (err: any) {
      setActionError(err?.message || "Error de red al devolver al bot.");
    } finally {
      setIsTogglingTakeover(false);
    }
  };

  // 3. Enviar mensaje como asesor humano
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvId || !inputContent.trim() || isSendingMessage) return;

    if (selectedConv?.status !== "human") {
      setActionError("Toma el control primero para responder.");
      return;
    }

    const contentToSend = inputContent.trim();
    setIsSendingMessage(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentToSend }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setActionError("Toma el control primero para responder.");
        return;
      }

      if (!res.ok) {
        setActionError(data?.error?.message || "Error al enviar mensaje.");
        return;
      }

      setInputContent("");
      setMessages((prev) => [...prev, data]);
      loadConversations(false);
    } catch (err: any) {
      setActionError(err?.message || "Error inesperado al enviar mensaje.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.visitor_name && c.visitor_name.toLowerCase().includes(q)) ||
      (c.client_name && c.client_name.toLowerCase().includes(q)) ||
      (c.external_chat_id && c.external_chat_id.toLowerCase().includes(q))
    );
  });

  const isHumanActive = selectedConv?.status === "human";

  return (
    <DashboardShell
      title="Bandeja de Conversaciones"
      subtitle="Bandeja omnicanal en tiempo real con Human Takeover y control de bots"
    >
      <div className="space-y-4">
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <span className="flex items-center gap-2 font-mono">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              )}
              {feedback.message}
            </span>
            <button onClick={() => setFeedback(null)} className="text-texter-text-dim hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-210px)] min-h-[580px]">
          {/* COLUMNA IZQUIERDA: BANDEJA */}
          <Card
            variant="elevated"
            className={`lg:col-span-5 flex flex-col p-0 overflow-hidden border-texter-border bg-texter-surface ${
              selectedConvId ? "hidden lg:flex" : "flex"
            }`}
          >
            <div className="p-3.5 border-b border-texter-border space-y-3 bg-texter-surface-subtle/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-texter-cyan" />
                  <h3 className="font-bold text-white text-sm">Bandeja ({filteredConversations.length})</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadConversations(true)}
                  disabled={isLoadingList}
                  className="h-7 px-2 text-texter-text-muted hover:text-white"
                  title="Refrescar lista"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? "animate-spin" : ""}`} />
                </Button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-texter-text-dim absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar visitante, negocio o sesión..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-texter-surface border border-texter-border text-xs text-white placeholder-texter-text-dim focus:outline-none focus:border-texter-cyan"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="p-1.5 rounded-lg bg-texter-surface border border-texter-border text-[11px] text-white outline-none"
                  title="Filtrar por Cliente"
                >
                  <option value="all">Todos los clientes</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  className="p-1.5 rounded-lg bg-texter-surface border border-texter-border text-[11px] text-white outline-none"
                  title="Filtrar por Canal"
                >
                  <option value="all">Canales</option>
                  <option value="widget">Widget Web</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="other">Otro</option>
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="p-1.5 rounded-lg bg-texter-surface border border-texter-border text-[11px] text-white outline-none"
                  title="Filtrar por Estado"
                >
                  <option value="all">Estados</option>
                  <option value="bot">Bot</option>
                  <option value="human">Humano</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-texter-border/50">
              {filteredConversations.map((conv) => {
                const isSelected = selectedConvId === conv.id;
                const formattedTime = new Date(conv.last_message_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={`p-3 cursor-pointer transition-colors space-y-1.5 relative ${
                      isSelected
                        ? "bg-texter-indigo/20 border-l-4 border-l-texter-indigo"
                        : "hover:bg-texter-surface-hover/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-white text-xs truncate">
                          {conv.visitor_name || "Visitante"}
                        </span>
                        {conv.unread_count > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full bg-texter-rose text-white text-[10px] font-mono font-bold shrink-0 animate-pulse">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-texter-text-dim font-mono shrink-0">
                        {formattedTime}
                      </span>
                    </div>

                    <div className="text-[11px] text-texter-text-muted truncate">
                      Negocio: <strong className="text-texter-text-secondary">{conv.client_name}</strong>
                    </div>

                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Badge
                        variant={
                          conv.channel === "widget"
                            ? "cyan"
                            : conv.channel === "whatsapp"
                            ? "success"
                            : conv.channel === "instagram"
                            ? "indigo"
                            : "default"
                        }
                        size="sm"
                        className="text-[9px] uppercase font-mono px-1.5 py-0"
                      >
                        {conv.channel}
                      </Badge>

                      <Badge
                        variant={
                          conv.status === "human"
                            ? "success"
                            : conv.status === "bot"
                            ? "cyan"
                            : "default"
                        }
                        size="sm"
                        dot
                        className="text-[9px] font-mono px-1.5 py-0"
                      >
                        {conv.status === "human" ? "Humano" : conv.status === "bot" ? "Bot" : "Pausado"}
                      </Badge>

                      <span className="text-[10px] text-texter-text-dim font-mono ml-auto truncate max-w-[120px]">
                        ID: {conv.external_chat_id.replace(/^sess_/, "")}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredConversations.length === 0 && !isLoadingList && (
                <div className="p-8 text-center text-texter-text-dim text-xs">
                  No hay conversaciones que coincidan con los filtros seleccionados.
                </div>
              )}
            </div>
          </Card>

          {/* COLUMNA DERECHA: CHAT Y TAKEOVER */}
          <Card
            variant="elevated"
            className={`lg:col-span-7 flex flex-col p-0 overflow-hidden border-texter-border bg-texter-surface ${
              !selectedConvId ? "hidden lg:flex" : "flex"
            }`}
          >
            {selectedConv ? (
              <>
                <div className="p-3.5 border-b border-texter-border bg-texter-surface-subtle/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedConvId(null)}
                      className="p-1 rounded-lg text-texter-text-muted hover:text-white lg:hidden"
                      title="Volver a la lista"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="w-8 h-8 rounded-full bg-texter-indigo/20 border border-indigo-500/30 flex items-center justify-center text-texter-indigo shrink-0">
                      <User className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-white text-sm truncate">
                          {selectedConv.visitor_name || "Visitante Web"}
                        </h4>
                        <Badge
                          variant={selectedConv.status === "human" ? "success" : "cyan"}
                          size="sm"
                          dot
                        >
                          {selectedConv.status === "human" ? "Atendido por Humano" : "Atendido por Bot"}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-texter-text-muted truncate">
                        Cliente: <strong className="text-white">{selectedConv.client_name}</strong> • Canal:{" "}
                        <span className="uppercase font-mono text-texter-cyan">{selectedConv.channel}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedConv.status === "bot" ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleTakeover}
                        isLoading={isTogglingTakeover}
                        className="text-xs flex items-center gap-1.5 shadow-sm"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Tomar control</span>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRelease}
                        isLoading={isTogglingTakeover}
                        className="text-xs flex items-center gap-1.5 text-texter-cyan hover:text-white"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        <span>Devolver al bot</span>
                      </Button>
                    )}
                  </div>
                </div>

                {actionError && (
                  <div className="p-2.5 mx-3.5 mt-2 rounded-lg bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-black/20">
                  {isLoadingMessages ? (
                    <div className="flex items-center justify-center h-full text-xs text-texter-text-dim">
                      <RefreshCw className="w-4 h-4 animate-spin text-texter-cyan mr-2" />
                      Cargando historial de mensajes...
                    </div>
                  ) : (
                    <>
                      {messages.map((m) => {
                        const isVisitor = m.role === "visitor";
                        const isBot = m.role === "bot";
                        const isHuman = m.role === "human_agent";
                        const timeStr = new Date(m.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div
                            key={m.id}
                            className={`flex flex-col ${isVisitor ? "items-start" : "items-end"}`}
                          >
                            <div className="flex items-center gap-1.5 mb-1 px-1">
                              {isVisitor && (
                                <span className="text-[10px] text-texter-text-muted font-bold font-mono">
                                  {selectedConv.visitor_name || "Visitante"}
                                </span>
                              )}
                              {isBot && (
                                <Badge variant="cyan" size="sm" className="text-[9px] px-1 py-0 font-mono">
                                  <Bot className="w-2.5 h-2.5 mr-1" />
                                  Bot
                                </Badge>
                              )}
                              {isHuman && (
                                <Badge variant="success" size="sm" className="text-[9px] px-1 py-0 font-mono">
                                  <UserCheck className="w-2.5 h-2.5 mr-1" />
                                  Tú (Asesor)
                                </Badge>
                              )}
                              <span className="text-[10px] text-texter-text-dim font-mono">{timeStr}</span>
                            </div>

                            <div
                              className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words shadow-sm ${
                                isVisitor
                                  ? "bg-texter-surface-subtle border border-texter-border text-white rounded-tl-sm"
                                  : isBot
                                  ? "bg-texter-indigo/20 border border-indigo-500/30 text-indigo-100 rounded-tr-sm"
                                  : "bg-emerald-600 text-white rounded-tr-sm shadow-emerald-950/20"
                              }`}
                            >
                              {m.content}
                            </div>
                          </div>
                        );
                      })}

                      {messages.length === 0 && (
                        <div className="p-8 text-center text-texter-text-dim text-xs">
                          No hay mensajes registrados en esta conversación todavía.
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="p-3 border-t border-texter-border bg-texter-surface-subtle/50 space-y-2">
                  {!isHumanActive && (
                    <div className="p-2 rounded-lg bg-texter-surface border border-texter-border flex items-center justify-between text-xs text-texter-text-muted">
                      <span className="flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-texter-cyan" />
                        El bot está respondiendo automáticamente este chat.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleTakeover}
                        className="text-[11px] h-6 px-2 text-texter-cyan hover:text-white"
                      >
                        Tomar control
                      </Button>
                    </div>
                  )}

                  <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      disabled={!isHumanActive || isSendingMessage}
                      placeholder={
                        isHumanActive
                          ? "Escribe una respuesta como asesor humano..."
                          : "Toma el control para responder"
                      }
                      className={`flex-1 px-3 py-2 rounded-xl border text-xs text-white outline-none transition-all ${
                        isHumanActive
                          ? "bg-texter-surface border-texter-border focus:border-texter-cyan"
                          : "bg-texter-surface-subtle/40 border-texter-border/50 text-texter-text-dim cursor-not-allowed"
                      }`}
                    />

                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      disabled={!isHumanActive || !inputContent.trim() || isSendingMessage}
                      isLoading={isSendingMessage}
                      className="h-9 px-3.5 flex items-center justify-center shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-texter-surface-subtle border border-texter-border flex items-center justify-center text-texter-text-dim">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Ninguna conversación seleccionada</h4>
                  <p className="text-xs text-texter-text-muted mt-1 max-w-sm">
                    Selecciona una conversación de la columna izquierda para revisar el historial en tiempo real y tomar el control humano cuando sea necesario.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
