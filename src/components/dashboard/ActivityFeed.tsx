import React from "react";
import { Card } from "@/components/ui/Card";
import { MOCK_ACTIVITIES } from "@/lib/mock-data";
import { Activity, ShieldCheck, Workflow, Bot, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const ActivityFeed: React.FC = () => {
  const getIcon = (type: string, status: string) => {
    switch (type) {
      case "security":
        return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
      case "agent":
        return <Bot className="w-4 h-4 text-cyan-400" />;
      case "automation":
        return <Workflow className="w-4 h-4 text-indigo-400" />;
      default:
        return status === "warning" ? (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        ) : (
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        );
    }
  };

  return (
    <Card variant="elevated" padding="none">
      <div className="p-4 border-b border-texter-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-texter-cyan" />
          Actividad del Sistema & Eventos
        </h3>
        <span className="text-[11px] font-mono text-texter-text-muted">En vivo</span>
      </div>

      <div className="p-4 divide-y divide-texter-border/40 space-y-3">
        {MOCK_ACTIVITIES.map((act) => (
          <div key={act.id} className="pt-3 first:pt-0 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-texter-surface-subtle border border-texter-border shrink-0 mt-0.5">
              {getIcon(act.type, act.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-white truncate">
                  {act.title}
                </p>
                <span className="text-[10px] font-mono text-texter-text-dim shrink-0">
                  {act.timestamp}
                </span>
              </div>
              <p className="text-[11px] text-texter-text-muted mt-0.5 leading-relaxed">
                {act.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
