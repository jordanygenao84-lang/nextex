"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Server,
  Cpu,
  PlayCircle,
  Bot,
  ShieldCheck,
  RefreshCw,
  FileText,
  Activity,
} from "lucide-react";

const navItems = [
  { name: "Overview", href: "/control-plane", icon: LayoutDashboard },
  { name: "Workers", href: "/control-plane/workers", icon: Server },
  { name: "Jobs", href: "/control-plane/jobs", icon: Cpu },
  { name: "Runs", href: "/control-plane/runs", icon: PlayCircle },
  { name: "Agentes", href: "/control-plane/agents", icon: Bot },
  { name: "Aprobaciones", href: "/control-plane/approvals", icon: ShieldCheck },
  { name: "Recuperación", href: "/control-plane/recovery", icon: RefreshCw },
  { name: "Auditoría", href: "/control-plane/audit", icon: FileText },
  { name: "Observabilidad", href: "/control-plane/observability", icon: Activity },
];

export const ControlPlaneNav: React.FC = () => {
  const pathname = usePathname();

  return (
    <div className="border-b border-texter-border bg-texter-surface/50 backdrop-blur-sm sticky top-0 z-30 mb-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center space-x-1 overflow-x-auto py-2.5 scrollbar-thin scrollbar-thumb-texter-border">
        {navItems.map((item) => {
          const isActive =
            item.href === "/control-plane"
              ? pathname === "/control-plane"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                isActive
                  ? "bg-texter-indigo text-white shadow-sm shadow-indigo-500/20 font-semibold"
                  : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
