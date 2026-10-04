"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { Integration } from "@/lib/integrations/types";
import {
  Webhook,
  Plus,
  Play,
  Pause,
  Ban,
  Radio,
  Clock,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

export default function IntegrationsPage() {
  const { workspace } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal de Creación
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("generic");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de Secreto Único
  const [secretModal, setSecretModal] = useState<{ plainSecret: string; endpointKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (workspace?.id) {
      loadIntegrations();
    }
  }, [workspace?.id]);

  const loadIntegrations = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/integrations?workspaceId=${workspace?.id}`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          name,
          provider,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Crear un endpoint por defecto para la nueva integración
        const epRes = await fetch(`/api/integrations/${data.integration.id}/endpoints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${name} Default Inbound`,
          }),
        });

        if (epRes.ok) {
          const epData = await epRes.json();
          setSecretModal({
            plainSecret: epData.plainSecret,
            endpointKey: epData.endpoint.endpoint_key,
          });
        }

        setIsCreateOpen(false);
        setName("");
        loadIntegrations();
      }
    } catch {
      // Error
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, action: "activate" | "pause" | "revoke") => {
    try {
      const res = await fetch(`/api/integrations/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        loadIntegrations();
      }
    } catch {
      // Error
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success" size="sm" dot>Activa</Badge>;
      case "paused":
        return <Badge variant="warning" size="sm" dot>Pausada</Badge>;
      case "revoked":
        return <Badge variant="error" size="sm" dot>Revocada</Badge>;
      case "archived":
        return <Badge variant="default" size="sm" dot>Archivada</Badge>;
      default:
        return <Badge variant="cyan" size="sm" dot>Borrador</Badge>;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Cabecera */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-texter-border pb-5">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Webhook className="w-6 h-6 text-texter-cyan" />
              Puertas de Integración y Eventos Externos
            </h1>
            <p className="text-xs text-texter-text-muted mt-1">
              Ingestión segura de webhooks con verificación criptográfica HMAC-SHA256, protección anti-replay y mapeo server-side.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nueva Integración
          </Button>
        </div>

        {/* Modal de Secreto Único de Creación */}
        {secretModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card variant="elevated" className="max-w-lg w-full space-y-4 border-texter-warning/50 bg-texter-surface">
              <div className="flex items-center gap-2 text-texter-warning font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                Guarda tu Secreto HMAC de Integración
              </div>
              <p className="text-xs text-texter-text-muted leading-relaxed">
                Por motivos estrictos de seguridad, este secreto criptográfico se genera en memoria y{" "}
                <strong className="text-white">solo se muestra esta única vez</strong>. La base de datos almacena únicamente una referencia opaca.
              </p>

              <div className="space-y-2">
                <label className="text-[11px] font-mono text-texter-text-dim">Secreto HMAC-SHA256:</label>
                <div className="flex items-center gap-2 bg-texter-surface-subtle p-2.5 rounded border border-texter-border font-mono text-xs text-white">
                  <span className="truncate flex-1 select-all">{secretModal.plainSecret}</span>
                  <button onClick={() => copyToClipboard(secretModal.plainSecret)} className="text-texter-cyan hover:text-white">
                    {copied ? <Check className="w-4 h-4 text-texter-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-mono text-texter-text-dim">Endpoint Key:</label>
                <div className="bg-texter-surface-subtle p-2 rounded border border-texter-border font-mono text-[11px] text-texter-text-dim truncate">
                  {secretModal.endpointKey}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={() => setSecretModal(null)}>
                  He guardado el secreto
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Modal de Registro de Integración */}
        {isCreateOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-center justify-center p-4">
            <Card variant="elevated" className="max-w-md w-full space-y-4">
              <h2 className="text-lg font-bold text-white">Crear Nueva Integración</h2>
              <form onSubmit={handleCreateIntegration} className="space-y-3">
                <div>
                  <label className="text-xs text-texter-text-muted">Nombre de la Integración:</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Webhooks de Pedidos" required />
                </div>
                <div>
                  <label className="text-xs text-texter-text-muted">Proveedor:</label>
                  <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="generic, custom, etc." />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" size="sm" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Creando..." : "Crear y Generar Claves"}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* Lista de Integraciones */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrations.map((integ) => (
            <Card key={integ.id} variant="elevated" className="space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-white text-base">{integ.name}</h3>
                  <span className="text-[11px] font-mono text-texter-text-dim uppercase tracking-wider">{integ.provider}</span>
                </div>
                {getStatusBadge(integ.status)}
              </div>

              <div className="text-xs font-mono bg-texter-surface-subtle p-2.5 rounded border border-texter-border space-y-1">
                <div className="flex justify-between text-texter-text-dim">
                  <span>Tipo:</span>
                  <span className="text-white capitalize">{integ.integration_type.replace("_", " ")}</span>
                </div>
                <div className="flex justify-between text-texter-text-dim">
                  <span>Creado:</span>
                  <span className="text-white">{new Date(integ.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-texter-border">
                <div className="flex items-center gap-1">
                  {integ.status === "active" ? (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(integ.id, "pause")} title="Pausar">
                      <Pause className="w-3.5 h-3.5 text-texter-warning" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleStatusChange(integ.id, "activate")} title="Activar">
                      <Play className="w-3.5 h-3.5 text-texter-success" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleStatusChange(integ.id, "revoke")} title="Revocar">
                    <Ban className="w-3.5 h-3.5 text-texter-error" />
                  </Button>
                </div>

                <Link href={`/integrations/${integ.id}`}>
                  <Button variant="outline" size="sm" className="flex items-center gap-1">
                    Administrar
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
          {integrations.length === 0 && !isLoading && (
            <div className="col-span-full py-12 text-center text-texter-text-dim">
              No hay integraciones configuradas en este workspace.
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
