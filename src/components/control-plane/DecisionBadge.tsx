"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertCircle, ShieldAlert, Clock } from "lucide-react";

export type DecisionType = "allow" | "deny" | "requires_approval" | "blocked" | "expired" | string;

interface DecisionBadgeProps {
  decision: DecisionType;
  className?: string;
  showIcon?: boolean;
}

export const DecisionBadge: React.FC<DecisionBadgeProps> = ({
  decision,
  className,
  showIcon = true,
}) => {
  const norm = String(decision || "").toLowerCase();

  switch (norm) {
    case "allow":
    case "approved":
    case "healthy":
    case "completed":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
            className
          )}
        >
          {showIcon && <CheckCircle2 className="w-3.5 h-3.5" />}
          {decision.toUpperCase()}
        </span>
      );

    case "deny":
    case "denied":
    case "rejected":
    case "failed":
    case "stopped":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-rose-500/10 text-rose-400 border border-rose-500/20",
            className
          )}
        >
          {showIcon && <XCircle className="w-3.5 h-3.5" />}
          {decision.toUpperCase()}
        </span>
      );

    case "requires_approval":
    case "waiting_approval":
    case "pending":
    case "draining":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-amber-500/10 text-amber-400 border border-amber-500/20",
            className
          )}
        >
          {showIcon && <AlertCircle className="w-3.5 h-3.5" />}
          {decision.toUpperCase()}
        </span>
      );

    case "blocked":
    case "quarantined":
    case "dead_letter":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-purple-500/10 text-purple-400 border border-purple-500/20",
            className
          )}
        >
          {showIcon && <ShieldAlert className="w-3.5 h-3.5" />}
          {decision.toUpperCase()}
        </span>
      );

    case "expired":
    case "stale":
    case "timeout":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-gray-500/10 text-gray-400 border border-gray-500/20",
            className
          )}
        >
          {showIcon && <Clock className="w-3.5 h-3.5" />}
          {decision.toUpperCase()}
        </span>
      );

    default:
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono",
            "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
            className
          )}
        >
          {decision.toUpperCase()}
        </span>
      );
  }
};
