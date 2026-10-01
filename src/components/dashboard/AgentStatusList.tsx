import React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MOCK_AGENTS } from "@/lib/mock-data";
import { Bot, CheckCircle2, MoreVertical } from "lucide-react";

export const AgentStatusList: React.FC = () => {
  return (
    <Card variant="elevated" padding="none">
      <div className="p-4 border-b border-texter-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Bot className="w-4 h-4 text-texter-indigo" />
          Agentes Autónomos Activos
        </h3>
        <Badge variant="indigo" size="sm">
          {MOCK_AGENTS.filter((a) => a.status === "active").length} en ejecución
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        {MOCK_AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border hover:border-texter-border-hover transition-colors flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-texter-surface border border-texter-border flex items-center justify-center font-mono font-bold text-xs text-texter-cyan shrink-0 shadow-sm">
                {agent.avatar}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white truncate">
                    {agent.name}
                  </h4>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      agent.status === "active"
                        ? "bg-texter-emerald animate-pulse"
                        : "bg-texter-amber"
                    }`}
                  />
                </div>
                <p className="text-[11px] text-texter-text-muted truncate">
                  {agent.role}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-xs font-mono font-semibold text-white">
                {agent.accuracy}
              </div>
              <div className="text-[10px] text-texter-text-dim font-mono">
                {agent.tasksCompleted} tareas
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
