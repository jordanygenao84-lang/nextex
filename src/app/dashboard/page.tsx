import React from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { JobsTable } from "@/components/dashboard/JobsTable";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AgentStatusList } from "@/components/dashboard/AgentStatusList";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { MOCK_METRICS } from "@/lib/mock-data";
import { Sparkles, Terminal } from "lucide-react";

export default function DashboardPage() {
  return (
    <DashboardShell
      title="Centro de Operaciones y Telemetría"
      subtitle="Monitoreo de agentes autónomos, pipelines y consumo en tiempo real"
    >
      <div className="space-y-6">
        {/* Top Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MOCK_METRICS.map((metric) => (
            <MetricCard key={metric.id} item={metric} />
          ))}
        </div>

        {/* Quick Action Shortcuts */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-texter-text-muted font-mono">
            Acciones Rápidas del Sistema
          </h2>
          <QuickActions />
        </div>

        {/* Main Jobs Table */}
        <JobsTable />

        {/* Two-column layout: Active Agents & System Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <AgentStatusList />
          </div>
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
