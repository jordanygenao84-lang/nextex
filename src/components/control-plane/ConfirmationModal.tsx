"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: string;
  resourceType: string;
  resourceId: string;
  workspaceId: string;
  impact: string;
  actionLabel?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
  error?: string | null;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  resourceType,
  resourceId,
  workspaceId,
  impact,
  actionLabel = "Confirmar Acción",
  variant = "danger",
  isLoading = false,
  error = null,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-texter-surface border border-texter-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-texter-border">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                variant === "danger"
                  ? "bg-rose-500/10 text-rose-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-texter-text-muted hover:text-white p-1 rounded-lg hover:bg-texter-surface-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-sm text-texter-text-secondary">
          <p>{description}</p>

          <div className="bg-texter-surface-subtle border border-texter-border rounded-xl p-3.5 space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-texter-text-muted">Tipo de Recurso:</span>
              <span className="text-white font-medium">{resourceType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-texter-text-muted">ID Recurso:</span>
              <span className="text-texter-cyan truncate max-w-[200px]">{resourceId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-texter-text-muted">Workspace:</span>
              <span className="text-texter-indigo truncate max-w-[200px]">{workspaceId}</span>
            </div>
            <div className="flex justify-between border-t border-texter-border/50 pt-2">
              <span className="text-texter-text-muted">Impacto Operacional:</span>
              <span className="text-rose-400 font-medium">{impact}</span>
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-texter-border bg-texter-surface-subtle/30">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading} size="sm">
            Cancelar
          </Button>
          <Button
            type="button"
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={isLoading}
            isLoading={isLoading}
            size="sm"
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
