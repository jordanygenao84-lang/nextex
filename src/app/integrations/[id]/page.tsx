"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { Integration, IntegrationEndpoint, IntegrationEvent } from "@/lib/integrations/types";
import {
  Webhook,
  ArrowLeft,
  Copy,
  Check,
  RotateCw,
  RefreshCw,
  AlertCircle,
  Clock,
  Terminal,
  Shield,
  Eye,
  KeyRound,
  AlertTriangle,
} from "lucide-react";

export default function IntegrationDetailPage({ params }: { params: { id: string } }) {
  const { workspace } = useAuth();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [endpoints, setEndpoints] = useState<IntegrationEndpoint[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modal para rotación de secreto única
  const [rotatedSecret, setRotatedSecret] = useState<{ plainSecret: string; endpointName: string } | null>(null);
  const [isRotating, setIsRotating] = useState<string | null>(null);
  const [modalCopied, setModalCopied] = useState(false);

  useEffect(() => {
    loadData();
  }, [params.id]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [intRes, epRes, evRes] = await Promise.all([
        fetch(`/api/integrations/${params.id}`),
        fetch(`/api/integrations/${params.id}/endpoints`),
        fetch(`/api/integrations/${params.id}/events`),
      ]);

      if (intRes.ok) {
        const d = await intRes.json();
        setIntegration(d.integration);
      }
      if (epRes.ok) {
        const d = await epRes.json();
        setEndpoints(d.endpoints || []);
      }
      if (evRes.ok) {
        const d = await evRes.json();
        setEvents(d.events || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = async (eventId: string) => {
    try {
      const res = await fetch(`/api/integrations/${params.id}/events/${eventId}/retry`, { method: "POST" });
      if (res.ok) {
        loadData();
      }
    } catch {
      // Error
    }
  };

  const handleReprocess = async (eventId: string) => {
    try {
      const res = await fetch(`/api/integrations/${params.id}/events/${eventId}/reprocess`, { method: "POST" });
      if (res.ok) {
        loadData();
      }
    } catch {
      // Error
    }
  };

  const handleRotateSecret = async (endpointId: string, endpointName: string) => {
    if (!confirm(`¿Está seguro de rotar la credencial de "${endpointName}"? El secreto actual pasará a secundario con un período de gracia de 24 horas.`)) {
      return;
    }

    setIsRotating(endpointId);
    try {
      const res = await fetch(`/api/integrations/${params.id}/endpoints/${endpointId}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grace_period_seconds: 86400 }),
      });

      if (res.ok) {
        const data = await res.json();
        setRotatedSecret({
          plainSecret: data.newPlainSecret,
          endpointName,
        });
        loadData();
      }
    } catch {
      // Error
    } finally {
      setIsRotating(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyModalSecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setModalCopied(true);
    setTimeout(() => setModalCopied(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "queued":
        return <Badge variant="cyan" size="sm" dot>Encolado</Badge>;
      case "processing":
        return <Badge variant="indigo" size="sm" dot>Procesando</Badge>;
      case "completed":
        return <Badge variant="success" size="sm" dot>Completado</Badge>;
      case "failed":
        return <Badge variant="error" size="sm" dot>Fallido</Badge>;
      case "quarantined":
        return <Badge variant="warning" size="sm" dot>Cuarentena</Badge>;
      case "duplicate":
        return <Badge variant="default" size="sm">Duplicado</Badge>;
      case "verified":
        return <Badge variant="indigo" size="sm">Verificado</Badge>;
      default:
        return <Badge variant="default" size="sm">Recibido</Badge>;
    }
  };

  if (!integration && !isLoading) {
    return (
      <DashboardShell>
        <div className="text-center py-12 text-white">Integración no encontrada.</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Cabecera */}
        <div className="flex items-center gap-3 border-b border-texter-border pb-4">
          <Link href="/integrations">
            <Button variant="ghost" size="sm" className="p-2">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Webhook className="w-5 h-5 text-texter-cyan" />
              {integration?.name || "Cargando..."}
            </h1>
            <p className="text-xs text-texter-text-muted">
              Proveedor: <span className="font-mono text-white">{integration?.provider}</span>
            </p>
          </div>
        </div>

        {/* Modal de Secreto Rotado Único */}
        {rotatedSecret && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card variant="elevated" className="max-w-lg w-full space-y-4 border-texter-warning/50 bg-texter-surface">
              <div className="flex items-center gap-2 text-texter-warning font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                Nuevo Secreto HMAC Generado — {rotatedSecret.endpointName}
              </div>
              <p className="text-xs text-texter-text-muted leading-relaxed">
                Guarde este nuevo secreto criptográfico ahora. <strong className="text-white">Solo se muestra esta única vez</strong>. La base de datos almacena únicamente la versión cifrada con AES-256-GCM y AAD. El secreto anterior seguirá funcionando durante un período de gracia de 24 horas.
              </p>

              <div className="space-y-2">
                <label className="text-[11px] font-mono text-texter-text-dim">Nuevo Secreto HMAC-SHA256:</label>
                <div className="flex items-center gap-2 bg-texter-surface-subtle p-2.5 rounded border border-texter-border font-mono text-xs text-white">
                  <span className="truncate flex-1 select-all">{rotatedSecret.plainSecret}</span>
                  <button onClick={() => copyModalSecret(rotatedSecret.plainSecret)} className="text-texter-cyan hover:text-white">
                    {modalCopied ? <Check className="w-4 h-4 text-texter-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={() => setRotatedSecret(null)}>
                  He guardado el nuevo secreto
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Panel de Endpoints */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-texter-indigo" />
            Endpoints Inbound Autorizados
          </h2>

          <div className="grid grid-cols-1 gap-3">
            {endpoints.map((ep) => {
              const inboundUrl = `https://nextex-seven.vercel.app/api/inbound/${ep.endpoint_key}`;
              return (
                <Card key={ep.id} variant="elevated" className="space-y-3 bg-texter-surface p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-white text-sm">{ep.name}</h3>
                      <p className="text-xs text-texter-text-muted">Método: HMAC-SHA256 (Binary Buffer, Constant-Time)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRotateSecret(ep.id, ep.name)}
                        disabled={isRotating === ep.id}
                        className="text-texter-warning border-texter-warning/30 hover:bg-texter-warning/10 text-xs"
                      >
                        <KeyRound className="w-3.5 h-3.5 mr-1" />
                        {isRotating === ep.id ? "Rotando..." : "Rotar Secreto"}
                      </Button>
                      <Badge variant={ep.status === "active" ? "success" : "default"} size="sm">
                        {ep.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-1.5 font-mono text-xs">
                    <label className="text-texter-text-dim text-[11px]">URL Pública del Webhook:</label>
                    <div className="flex items-center gap-2 bg-texter-surface-subtle p-2 rounded border border-texter-border text-white">
                      <span className="truncate flex-1 select-all">{inboundUrl}</span>
                      <button onClick={() => copyToClipboard(inboundUrl, ep.id)} className="text-texter-cyan hover:text-white">
                        {copiedKey === ep.id ? <Check className="w-4 h-4 text-texter-success" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-texter-text-dim bg-texter-surface-subtle/50 p-2.5 rounded border border-texter-border space-y-1">
                    <div className="text-white font-semibold mb-1">Cabeceras Requeridas del Protocolo:</div>
                    <div><span className="text-texter-cyan">X-Nextex-Timestamp:</span> Unix epoch seconds (10 dígitos exactos)</div>
                    <div><span className="text-texter-cyan">X-Nextex-Signature:</span> HMAC-SHA256(secret, Buffer.concat([timestamp + &quot;.&quot;, rawBody]))</div>
                    <div><span className="text-texter-cyan">X-Nextex-Event-Id:</span> Identificador único del evento (/^[A-Za-z0-9_.:-]{'{1,255}'}$/)</div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Panel de Eventos Recibidos */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-texter-indigo" />
              Eventos Recibidos y Estado de Ingestión
            </h2>
            <Button variant="ghost" size="sm" onClick={loadData} className="flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </Button>
          </div>

          <Card variant="elevated" className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                  <tr>
                    <th className="p-3">External Event ID</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Firma</th>
                    <th className="p-3">Job Run (Actual)</th>
                    <th className="p-3">Recibido</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-texter-border/50">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-texter-surface-hover/50">
                      <td className="p-3 font-mono text-white font-semibold">{ev.external_event_id}</td>
                      <td className="p-3 font-mono text-texter-cyan">{ev.event_type}</td>
                      <td className="p-3">{getStatusBadge(ev.status)}</td>
                      <td className="p-3">
                        {ev.signature_verified ? (
                          <span className="text-texter-success font-mono text-[11px]">✓ Verificada</span>
                        ) : (
                          <span className="text-texter-error font-mono text-[11px]">✗ Inválida</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-texter-text-dim">
                        {ev.job_run_id ? (
                          <span className="text-white">{ev.job_run_id.substring(0, 8)}...</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-texter-text-muted">{new Date(ev.received_at).toLocaleTimeString()}</td>
                      <td className="p-3 text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(ev)} title="Ver Payload">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {ev.status === "failed" && (
                          <Button variant="outline" size="sm" onClick={() => handleRetry(ev.id)} className="text-texter-warning">
                            <RotateCw className="w-3 h-3 mr-1" />
                            Retry
                          </Button>
                        )}
                        {(ev.status === "received" || ev.status === "verified") && (
                          <Button variant="outline" size="sm" onClick={() => handleReprocess(ev.id)} className="text-texter-cyan">
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Reprocess
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-texter-text-dim">
                        No se han recibido eventos para esta integración.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Modal de Detalle / Payload Sanitizado */}
        {selectedEvent && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card variant="elevated" className="max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-texter-border pb-2">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-texter-cyan" />
                  Detalle del Evento — {selectedEvent.external_event_id}
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                  Cerrar
                </Button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-texter-surface-subtle p-2.5 rounded border border-texter-border font-mono">
                  <div>Estado: <span className="text-white font-semibold">{selectedEvent.status}</span></div>
                  <div>Tipo: <span className="text-white font-semibold">{selectedEvent.event_type}</span></div>
                  <div>Payload Hash: <span className="text-white truncate block">{selectedEvent.payload_hash}</span></div>
                  <div>Job Run ID: <span className="text-white">{selectedEvent.job_run_id || "Ninguno"}</span></div>
                  {selectedEvent.quarantine_reason && (
                    <div className="col-span-2 text-texter-error">
                      Motivo de Cuarentena: {selectedEvent.quarantine_reason}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-mono text-texter-text-dim">Payload (Sanitizado):</label>
                  <pre className="bg-texter-surface-subtle p-3 rounded border border-texter-border font-mono text-[11px] text-white overflow-x-auto">
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </pre>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
