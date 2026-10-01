import React from "react";
import { Card } from "@/components/ui/Card";
import { MetricItem } from "@/lib/mock-data";
import { Cpu, Workflow, CheckCircle2, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ReactNode> = {
  Cpu: <Cpu className="w-5 h-5 text-texter-indigo" />,
  Workflow: <Workflow className="w-5 h-5 text-texter-cyan" />,
  CheckCircle2: <CheckCircle2 className="w-5 h-5 text-texter-emerald" />,
  Zap: <Zap className="w-5 h-5 text-texter-amber" />,
};

export const MetricCard: React.FC<{ item: MetricItem }> = ({ item }) => {
  return (
    <Card variant="elevated" padding="md" glow="none" className="group hover:border-texter-border-hover">
      <div className="flex items-start justify-between">
        <div className="p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border">
          {iconMap[item.iconName] || <Cpu className="w-5 h-5 text-texter-indigo" />}
        </div>
        <div
          className={cn(
            "flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded-full border",
            item.isPositive
              ? "bg-texter-emerald/10 text-emerald-400 border-emerald-500/20"
              : "bg-texter-rose/10 text-rose-400 border-rose-500/20"
          )}
        >
          {item.isPositive ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownRight className="w-3 h-3" />
          )}
          <span>{item.change}</span>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <p className="text-xs text-texter-text-muted font-medium">{item.label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black font-mono tracking-tight text-white">
            {item.value}
          </span>
          <span className="text-[11px] text-texter-text-dim">{item.timeframe}</span>
        </div>
      </div>

      {/* Subtle indicator bar */}
      <div className="mt-3.5 h-1 w-full bg-texter-surface-subtle rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            item.iconName === "Cpu" && "bg-gradient-to-r from-texter-indigo to-texter-cyan w-3/4",
            item.iconName === "Workflow" && "bg-gradient-to-r from-texter-cyan to-texter-emerald w-4/5",
            item.iconName === "CheckCircle2" && "bg-gradient-to-r from-texter-emerald to-emerald-300 w-[99%]",
            item.iconName === "Zap" && "bg-gradient-to-r from-texter-amber to-yellow-300 w-2/3"
          )}
        />
      </div>
    </Card>
  );
};
