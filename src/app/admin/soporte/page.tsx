"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import {
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  ShieldCheck,
} from "lucide-react";

interface SupportTicketItem {
  id: string;
  client_id: string;
  subject: string;
  status: "open" | "in_progress" | "closed";
  priority: "low" | "normal" | "high";
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

interface TicketMessageItem {
  id: string;
  ticket_id: string;
  author: "client" | "admin";
  body: string;
  created_at: string;
}

interface ClientOption {
  id: string;
  display_name: string;
}

export default function AdminSoportePage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Filtros
  const [filterClientId, setFilterClientId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  // Detalle de ticket seleccionado
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketItem | null>(
    null
  );
  const [messages, setMessages] = useState<TicketMessageItem[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isUpdatingTicket, setIsUpdatingTicket] = useState(false);

  // Ref con el id del ticket seleccionado. loadTickets NO puede depender de
  // selectedTicket: cada fetch crea un objeto nuevo y eso re-disparaba el
  // efecto en bucle (el lag de la página). El ref no cambia la identidad
  // del callback y rompe el ciclo.
  const selectedTicketIdRef = useRef<string | null>(null);

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const json = await res.json();
        const list = Array.isArray(json) ? json : json.clients || [];
        setClients(
          list.map((c: any) => ({
            id: c.id,
            display_name: c.display_name,
          }))
        );
      }
    } catch {
      // Silencioso
    }
  }, []);

  const loadTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterClientId) params.set("client_id", filterClientId);
      if (filterStatus) params.set("status", filterStatus);

      const qs = params.toString();
      const res = await fetch(`/api/admin/tickets${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });

      if (res.status === 401) {
        router.push("/login?redirect=/admin/soporte");
        return;
      }

      if (res.status === 403) {
        setIsForbidden(true);
        return;
      }

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message || "No se pudieron cargar los tickets."
        );
      }

      const list: SupportTicketItem[] = json.tickets || [];
      setTickets(list);

      const selectedId = selectedTicketIdRef.current;
      if (selectedId) {
        const updatedMatch = list.find((t) => t.id === selectedId);
        if (updatedMatch) {
          // Solo actualizar si algo cambió: si devolvemos el objeto previo,
          // React no re-renderiza ni cambia la identidad del callback.
          setSelectedTicket((prev) => {
            if (
              prev &&
              prev.id === updatedMatch.id &&
              prev.status === updatedMatch.status &&
              prev.priority === updatedMatch.priority &&
              prev.updated_at === updatedMatch.updated_at &&
              prev.subject === updatedMatch.subject
            ) {
              return prev;
            }
            return updatedMatch;
          });
        } else {
          // El ticket seleccionado ya no está en la lista (filtro o cierre):
          // limpiar la selección en vez de mostrar un detalle obsoleto.
          selectedTicketIdRef.current = null;
          setSelectedTicket(null);
        }
      } else if (list.length > 0) {
        loadTicketDetail(list[0].id);
      }
    } catch (err: any) {
      setError(err?.message || "Error al cargar tickets de soporte.");
    } finally {
      setIsLoading(false);
    }
  }, [filterClientId, filterStatus, router]);

  const loadTicketDetail = async (ticketId: string) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json.ticket) {
        selectedTicketIdRef.current = ticketId;
        setSelectedTicket(json.ticket);
        setMessages(Array.isArray(json.messages) ? json.messages : []);
      }
    } catch {
      // Silencioso
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading) {
      if (!user) {
        router.push("/login?redirect=/admin/soporte");
      } else {
        loadClients();
        loadTickets();
      }
    }
  }, [user, isAuthLoading, router, loadClients, loadTickets]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;

    setIsSendingReply(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyText.trim() }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: json?.error?.message || "No se pudo enviar la respuesta.",
        });
        return;
      }

      setReplyText("");
      await loadTicketDetail(selectedTicket.id);
      await loadTickets();
      setFeedback({
        type: "success",
        message: "Respuesta enviada correctamente.",
      });
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error al enviar la respuesta.",
      });
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleUpdateTicket = async (
    ticketId: string,
    patch: { status?: "open" | "in_progress" | "closed"; priority?: "low" | "normal" | "high" }
  ) => {
    setIsUpdatingTicket(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: json?.error?.message || "No se pudo actualizar el ticket.",
        });
        return;
      }

      if (json.ticket) {
        setSelectedTicket(json.ticket);
      }
      await loadTickets();
      setFeedback({
        type: "success",
        message:
          patch.status === "closed"
            ? "Ticket cerrado correctamente."
            : "Ticket actualizado.",
      });
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error al actualizar el ticket.",
      });
    } finally {
      setIsUpdatingTicket(false);
    }
  };

  const renderStatusBadge = (status: SupportTicketItem["status"]) => {
    switch (status) {
      case "open":
        return (
          <Badge variant="success" size="sm" dot>
            open
          </Badge>
        );
      case "in_progress":
        return (
          <Badge variant="warning" size="sm" dot>
            in_progress
          </Badge>
        );
      case "closed":
        return (
          <Badge variant="default" size="sm" dot>
            closed
          </Badge>
        );
    }
  };

  const renderPriorityBadge = (priority: SupportTicketItem["priority"]) => {
    switch (priority) {
      case "high":
        return (
          <Badge variant="danger" size="sm">
            high
          </Badge>
        );
      case "normal":
        return (
          <Badge variant="cyan" size="sm">
            normal
          </Badge>
        );
      case "low":
        return (
          <Badge variant="default" size="sm">
            low
          </Badge>
        );
    }
  };

  if (isForbidden) {
    return (
      <DashboardShell>
        <div className="max-w-lg mx-auto my-20">
          <Card
            variant="elevated"
            className="text-center py-10 px-6 space-y-4 border-texter-rose/40"
          >
            <div className="w-12 h-12 rounded-2xl bg-texter-rose/10 border border-texter-rose/30 flex items-center justify-center mx-auto text-texter-rose">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">Acceso Restringido</h2>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              El panel de Soporte Centralizado es exclusivo para
              superadministradores de la plataforma NEXTEХ.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard")}
              >
                Volver al Dashboard
              </Button>
            </div>
          </Card>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <AdminNav />

      <div className="space-y-6">
        {/* Encabezado */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
              <MessageSquare className="w-6 h-6 text-texter-cyan" />
              <span>Soporte Centralizado</span>
            </h1>
            <p className="text-xs sm:text-sm text-texter-text-muted mt-1">
              Bandeja unificada de tickets reportados desde las webs satélite
              con hilo de respuestas y gestión de estado.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTickets}
              disabled={isLoading}
              className="flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
              <span>Actualizar</span>
            </Button>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Cerrar
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Filtros */}
        <Card variant="elevated" className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                Filtrar por Cliente
              </label>
              <select
                value={filterClientId}
                onChange={(e) => setFilterClientId(e.target.value)}
                className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
              >
                <option value="">Todos los clientes</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-mono uppercase text-texter-text-muted">
                Filtrar por Estado
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none"
              >
                <option value="">Todos los estados</option>
                <option value="open">open (Abiertos)</option>
                <option value="in_progress">in_progress (En curso)</option>
                <option value="closed">closed (Cerrados)</option>
              </select>
            </div>

            <div className="flex items-center justify-end text-xs font-mono text-texter-text-muted">
              Total: <strong className="text-white ml-1">{tickets.length}</strong>{" "}
              tickets
            </div>
          </div>
        </Card>

        {/* Layout Maestro-Detalle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Columna Izquierda: Lista de Tickets */}
          <Card variant="elevated" className="lg:col-span-5 space-y-3 p-4">
            <h2 className="text-sm font-bold text-white border-b border-texter-border pb-2.5">
              Tickets Recibidos
            </h2>

            <div className="divide-y divide-texter-border/60 max-h-[600px] overflow-y-auto">
              {tickets.map((t) => {
                const isSelected = selectedTicket?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => loadTicketDetail(t.id)}
                    className={`p-3 cursor-pointer transition-colors rounded-lg ${
                      isSelected
                        ? "bg-texter-indigo/15 border border-indigo-500/40"
                        : "hover:bg-texter-surface-hover"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-white line-clamp-1">
                        {t.subject}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        {renderPriorityBadge(t.priority)}
                        {renderStatusBadge(t.status)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 text-[11px] text-texter-text-muted">
                      <span className="font-medium text-texter-cyan">
                        {t.client?.display_name || "Cliente"}
                      </span>
                      <span className="font-mono flex items-center gap-1 text-[10px]">
                        <Clock className="w-3 h-3" />
                        {new Date(t.updated_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}

              {tickets.length === 0 && !isLoading && (
                <div className="py-10 text-center text-xs text-texter-text-dim">
                  No hay tickets de soporte con los filtros actuales.
                </div>
              )}

              {isLoading && (
                <div className="py-10 text-center text-xs text-texter-text-dim">
                  Cargando tickets...
                </div>
              )}
            </div>
          </Card>

          {/* Columna Derecha: Detalle e Hilo de Mensajes */}
          <Card variant="elevated" className="lg:col-span-7 p-4 flex flex-col justify-between min-h-[480px]">
            {!selectedTicket ? (
              <div className="my-auto text-center py-16 text-xs text-texter-text-dim">
                Selecciona un ticket de la lista para ver su hilo de mensajes y responder.
              </div>
            ) : (
              <div className="space-y-4 flex-1 flex flex-col">
                {/* Cabecera del Ticket */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-texter-border pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-white">
                        {selectedTicket.subject}
                      </h3>
                      {renderStatusBadge(selectedTicket.status)}
                      {renderPriorityBadge(selectedTicket.priority)}
                    </div>
                    <p className="text-xs text-texter-text-muted mt-1">
                      Cliente:{" "}
                      <strong className="text-texter-cyan">
                        {selectedTicket.client?.display_name || selectedTicket.client_id}
                      </strong>{" "}
                      · Creado: {new Date(selectedTicket.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selectedTicket.priority}
                      disabled={isUpdatingTicket}
                      onChange={(e) =>
                        handleUpdateTicket(selectedTicket.id, {
                          priority: e.target.value as "low" | "normal" | "high",
                        })
                      }
                      className="p-1.5 rounded-lg bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                      title="Cambiar prioridad"
                    >
                      <option value="low">Prioridad: low</option>
                      <option value="normal">Prioridad: normal</option>
                      <option value="high">Prioridad: high</option>
                    </select>

                    {selectedTicket.status !== "closed" && (
                      <Button
                        variant="danger"
                        size="sm"
                        type="button"
                        isLoading={isUpdatingTicket}
                        onClick={() =>
                          handleUpdateTicket(selectedTicket.id, { status: "closed" })
                        }
                      >
                        Cerrar ticket
                      </Button>
                    )}

                    {selectedTicket.status === "closed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        isLoading={isUpdatingTicket}
                        onClick={() =>
                          handleUpdateTicket(selectedTicket.id, {
                            status: "in_progress",
                          })
                        }
                      >
                        Reabrir ticket
                      </Button>
                    )}
                  </div>
                </div>

                {/* Hilo de Mensajes */}
                <div className="flex-1 space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {isLoadingDetail ? (
                    <div className="py-10 text-center text-xs text-texter-text-dim">
                      Cargando mensajes del ticket...
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isAdmin = msg.author === "admin";
                      return (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                            isAdmin
                              ? "bg-texter-indigo/15 border-indigo-500/30 ml-6"
                              : "bg-texter-surface-subtle border-texter-border mr-6"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span
                              className={`font-bold flex items-center gap-1.5 ${
                                isAdmin ? "text-texter-cyan" : "text-amber-300"
                              }`}
                            >
                              {isAdmin ? (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Soporte Admin (NEXTEX)
                                </>
                              ) : (
                                <>
                                  <User className="w-3.5 h-3.5" />
                                  Cliente ({selectedTicket.client?.display_name || "Satélite"})
                                </>
                              )}
                            </span>
                            <span className="font-mono text-texter-text-dim text-[10px]">
                              {new Date(msg.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-white whitespace-pre-wrap leading-relaxed">
                            {msg.body}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Caja de Respuesta */}
                <form
                  onSubmit={handleSendReply}
                  className="pt-3 border-t border-texter-border space-y-2.5"
                >
                  <label className="text-xs font-medium text-texter-text-secondary block">
                    Responder como Administrador
                  </label>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    placeholder="Escribe tu respuesta para este ticket..."
                    required
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none focus:border-texter-cyan font-sans"
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      isLoading={isSendingReply}
                      className="flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar respuesta</span>
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
