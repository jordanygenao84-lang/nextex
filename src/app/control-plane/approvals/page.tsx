"use client";

import React, { useState, useEffect } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ControlPlaneNav } from "@/components/control-plane/ControlPlaneNav";
import { DecisionBadge } from "@/components/control-plane/DecisionBadge";
import { ConfirmationModal } from "@/components/control-plane/ConfirmationModal";
import {
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  Clock,
  Layers,
  FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ApprovalItem {
  id: string;
  workspace_id: string;
  run_id: string;
  step_id: string;
  tool_id: string;
  tool_version: string;
  requester_id: string;
  risk_level: string;
  payload_hash: string;
  status: string;
  approver_id: string | null;
  comment: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

export default function ApprovalsControlPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    approvalId: string;
    toolId: string;
    action: "approve" | "reject";
    title: string;
    description: string;
    impact: string;
  }>({
    isOpen: false,
    approvalId: "",
    toolId: "",
    action: "approve",
    title: "",
    description: "",
    impact: "",
  });

  const [isExecutingAction, setIsExecutingAction] = useState(false);

  const fetchApprovals = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/control-plane/approvals");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
      }
      const data = await res.json();
      setApprovals(data.approvals || []);
      setCurrentUserId(data.currentUserId || "");
      setCurrentUserRole(data.currentUserRole || "");
    } catch (err: any) {
      setError(err.message || "Error al cargar solicitudes de aprobación");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, []);

  const openActionModal = (approval: ApprovalItem, action: "approve" | "reject") => {
    const isApprove = action === "approve";
    setModalState({
      isOpen: true,
      approvalId: approval.id,
      toolId: approval.tool_id,
      action,
      title: isApprove ? "Aprobar Ejecución de Herramienta" : "Rechazar Solicitud HITL",
      description: isApprove
        ? `Autorizará la ejecución de la herramienta de riesgo '${approval.tool_id}' para el run '${approval.run_id}'.`
        : `Rechazará la ejecución de '${approval.tool_id}'. El run avanzará con estado cancelado/rechazado.`,
      impact: isApprove
        ? `Transición a APPROVED y re-encolamiento autorizado con hash ${approval.payload_hash.slice(0, 10)}.`
        : "Cancelación segura de la mutación. No se realizarán efectos secundarios.",
    });
  };

  const handleConfirmAction = async () => {
    try {
      setIsExecutingAction(true);
      setError(null);

      const res = await fetch("/api/control-plane/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: modalState.approvalId,
          action: modalState.action,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error?.message || `Error en la acción (${res.status})`);
      }

      setModalState((prev) => ({ ...prev, isOpen: false }));
      await fetchApprovals();
    } catch (err: any) {
      setError(err.message || "Error al resolver la aprobación");
    } finally {
      setIsExecutingAction(false);
    }
  };

  return (
    <DashboardShell
      title="Aprobaciones Human-in-the-Loop (HITL)"
      subtitle="Supervisión de solicitudes de herramientas de riesgo, anti-self approval, inmutabilidad y control de expiración"
    >
      <ControlPlaneNav />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-white font-semibold text-lg">Solicitudes HITL</h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-texter-surface border border-texter-border text-texter-text-muted">
              {approvals.length} registros
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchApprovals}
            disabled={isLoading}
            className="flex items-center gap-2 border border-texter-border hover:bg-texter-surface-hover text-xs font-mono"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-texter-surface border border-texter-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-texter-border bg-texter-surface-subtle/40 text-texter-text-muted">
                  <th className="py-3 px-4 font-semibold">HERRAMIENTA</th>
                  <th className="py-3 px-4 font-semibold">RIESGO</th>
                  <th className="py-3 px-4 font-semibold">ESTADO</th>
                  <th className="py-3 px-4 font-semibold">RUN ID</th>
                  <th className="py-3 px-4 font-semibold">SOLICITANTE</th>
                  <th className="py-3 px-4 font-semibold">PAYLOAD HASH</th>
                  <th className="py-3 px-4 font-semibold">EXPIRACIÓN</th>
                  <th className="py-3 px-4 font-semibold text-right">RESOLUCIÓN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50 text-texter-text-secondary">
                {approvals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-texter-text-muted">
                      {isLoading ? "Consultando aprobaciones..." : "No hay aprobaciones pendientes o históricas."}
                    </td>
                  </tr>
                ) : (
                  approvals.map((a) => {
                    const isSelf = a.requester_id === currentUserId;
                    const isPending = a.status === "pending";
                    const isExpired = a.expires_at && Date.now() > new Date(a.expires_at).getTime();

                    return (
                      <tr key={a.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{a.tool_id}</div>
                          <div className="text-[10px] text-texter-text-muted truncate max-w-[120px]">
                            v{a.tool_version || "1.0"}
                          </div>
                        </td>
                        <td className="py-3 px-4 uppercase text-amber-400 font-bold">
                          {a.risk_level}
                        </td>
                        <td className="py-3 px-4">
                          <DecisionBadge decision={isExpired && isPending ? "expired" : a.status} />
                        </td>
                        <td className="py-3 px-4 text-texter-cyan">
                          {a.run_id.slice(0, 8)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-texter-text-muted">{a.requester_id.slice(0, 8)}</span>
                          {isSelf && (
                            <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              Tú
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-texter-indigo text-[10px] truncate max-w-[120px]">
                          {a.payload_hash ? a.payload_hash.slice(0, 12) + "..." : "—"}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-texter-text-muted">
                          {a.expires_at ? new Date(a.expires_at).toLocaleTimeString() : "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isPending && !isExpired && (
                            <div className="flex items-center justify-end gap-1.5">
                              {isSelf ? (
                                <span className="text-[10px] text-purple-400 italic">
                                  Auto-aprobación prohibida
                                </span>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openActionModal(a, "approve")}
                                    className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 px-2 py-1 h-auto"
                                  >
                                    Aprobar
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openActionModal(a, "reject")}
                                    className="text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 h-auto"
                                  >
                                    Rechazar
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={modalState.title}
        description={modalState.description}
        resourceType="approval"
        resourceId={modalState.toolId}
        workspaceId="Workspace Activo"
        impact={modalState.impact}
        actionLabel={modalState.action === "approve" ? "Autorizar Ejecución" : "Rechazar Solicitud"}
        isLoading={isExecutingAction}
        variant={modalState.action === "approve" ? "warning" : "danger"}
      />
    </DashboardShell>
  );
}
