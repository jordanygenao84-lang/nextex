"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquareCode,
  Users,
  MoreHorizontal,
  X,
  Bot,
  Cpu,
  Briefcase,
  Workflow,
  Layers,
  Gauge,
  MessageSquare,
  Activity,
  ShieldCheck,
  Receipt,
  BarChart3,
  Globe,
  Settings,
} from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface DashboardShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

// Destinations shown only inside the mobile "••• Más" sheet (desktop
// sidebar is unchanged and keeps its full menu).
const MORE_LINKS = [
  { name: "Agentes Autónomos", href: "/agents", icon: Bot },
  { name: "Control Plane", href: "/control-plane", icon: Cpu },
  { name: "Tareas & Jobs", href: "/jobs", icon: Briefcase },
  { name: "Automatizaciones", href: "/automations", icon: Workflow },
  { name: "Herramientas e IA", href: "/integrations", icon: Layers },
  { name: "Flota de Carga", href: "/fleet", icon: Gauge },
  { name: "Conversaciones", href: "/conversations", icon: MessageSquare },
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Vigilancia", href: "/admin/vigilancia", icon: Activity },
  { name: "Protección", href: "/admin/proteccion", icon: ShieldCheck },
  { name: "Facturación", href: "/admin/facturacion", icon: Receipt },
  { name: "Analítica", href: "/admin/analitica", icon: BarChart3 },
  { name: "Dominios", href: "/admin/dominios", icon: Globe },
  { name: "Soporte", href: "/admin/soporte", icon: MessageSquare },
  { name: "Configuración & Cuenta", href: "/settings", icon: Settings },
];

export const DashboardShell: React.FC<DashboardShellProps> = ({
  children,
  title,
  subtitle,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const moreActive = MORE_LINKS.some((l) => isActive(l.href));

  const barItem = (
    href: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    active: boolean,
    onClick?: () => void
  ) => (
    <Link
      key={label}
      href={href}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
        active ? "text-texter-cyan" : "text-texter-text-muted"
      )}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-texter-bg text-texter-text-primary flex">
      {/* Sidebar Component (desktop unchanged) */}
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 transition-all duration-300">
        <Header
          onOpenMobile={() => setMobileOpen(true)}
          title={title}
          subtitle={subtitle}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-32 lg:pb-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile bottom bar (≤ lg): main destinations + "••• Más" sheet */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}
      {moreOpen && (
        <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 lg:hidden max-h-[60vh] overflow-y-auto rounded-2xl bg-texter-surface border border-texter-border shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-texter-border sticky top-0 bg-texter-surface">
            <span className="text-xs font-semibold text-white font-mono uppercase tracking-wider">
              Más destinos
            </span>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-1.5 text-texter-text-muted hover:text-white rounded-lg hover:bg-texter-surface-hover"
              aria-label="Cerrar menú Más"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 p-3">
            {MORE_LINKS.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : isActive(item.href);
              return (
                <Link
                  key={item.href + item.name}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors",
                    active
                      ? "bg-texter-indigo/15 text-white border-indigo-500/30"
                      : "text-texter-text-secondary hover:text-white hover:bg-texter-surface-hover border-transparent"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0 text-texter-cyan" />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 lg:hidden grid grid-cols-4 bg-texter-surface/95 backdrop-blur border border-texter-border rounded-2xl shadow-2xl">
        {barItem("/dashboard", "Dashboard", LayoutDashboard, pathname === "/dashboard")}
        {barItem("/chat", "Chat", MessageSquareCode, pathname === "/chat")}
        {barItem("/clients", "Clientes", Users, pathname === "/clients" || pathname.startsWith("/clients/"))}
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
            moreOpen || moreActive ? "text-texter-cyan" : "text-texter-text-muted"
          )}
          aria-label="Más destinos"
        >
          <MoreHorizontal className="w-5 h-5" />
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
};
