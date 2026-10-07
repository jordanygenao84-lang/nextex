"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquareCode,
  Workflow,
  Cpu,
  Layers,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sparkles,
  X,
  Loader2,
  Bot,
  Briefcase,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/context/AuthContext";

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen = false,
  onCloseMobile,
}) => {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { user, profile, signOut } = useAuth();

  const mainNav = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      badge: "En vivo",
    },
    {
      name: "Chat & Modelos",
      href: "/chat",
      icon: MessageSquareCode,
      badge: "Multi-Model",
    },
    {
      name: "Agentes Autónomos",
      href: "/agents",
      icon: Bot,
      badge: "Core v4.1",
    },
    {
      name: "Control Plane",
      href: "/control-plane",
      icon: Cpu,
      badge: "v4.10",
    },
    {
      name: "Tareas & Jobs",
      href: "/jobs",
      icon: Briefcase,
      badge: "Durable",
    },
    {
      name: "Automatizaciones",
      href: "/automations",
      icon: Workflow,
    },
    {
      name: "Herramientas e IA",
      href: "/integrations",
      icon: Layers,
    },
  ];

  const secondaryNav = [
    {
      name: "Seguridad & RLS",
      href: "/control-plane",
      icon: ShieldCheck,
    },
    {
      name: "Configuración & Cuenta",
      href: "/settings",
      icon: Settings,
    },
  ];

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    await signOut();
    setIsLoggingOut(false);
  };

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "Jordany Genao";
  const displayEmail = user?.email || "Jordanygenao84@gmail.com";
  const userPlan = (profile?.plan || "free").toUpperCase();
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "NX";

  return (
    <>
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-texter-surface border-r border-texter-border transition-all duration-300 ease-in-out",
          collapsed ? "lg:w-20" : "lg:w-64",
          "w-72 lg:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-texter-border">
          <Link
            href="/"
            className="flex items-center gap-2.5 group overflow-hidden"
          >
            {collapsed ? (
              <Logo variant="monogram" size="md" />
            ) : (
              <Logo variant="full" size="sm" showTagline={true} />
            )}
          </Link>

          <button
            onClick={onCloseMobile}
            className="p-1.5 text-texter-text-muted hover:text-white rounded-lg hover:bg-texter-surface-hover lg:hidden"
            aria-label="Cerrar navegación"
          >
            <X className="w-5 h-5" />
          </button>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1.5 text-texter-text-muted hover:text-white rounded-lg hover:bg-texter-surface-hover border border-texter-border/50"
            aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div>
            {!collapsed && (
              <p className="px-2 mb-2 text-[10px] font-semibold text-texter-text-dim uppercase tracking-wider font-mono">
                Plataforma NEXTEХ
              </p>
            )}
            <nav className="space-y-1">
              {mainNav.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onCloseMobile}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group select-none relative",
                      isActive
                        ? "bg-texter-indigo/15 text-white border border-indigo-500/30 shadow-sm"
                        : "text-texter-text-secondary hover:text-white hover:bg-texter-surface-hover hover:border-texter-border border border-transparent"
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <Icon
                      className={cn(
                        "w-5 h-5 shrink-0 transition-colors",
                        isActive
                          ? "text-texter-indigo"
                          : "text-texter-text-muted group-hover:text-texter-text-primary"
                      )}
                    />
                    {!collapsed && (
                      <span className="truncate flex-1">{item.name}</span>
                    )}
                    {!collapsed && item.badge && (
                      <Badge
                        variant={isActive ? "indigo" : "default"}
                        size="sm"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {item.badge}
                      </Badge>
                    )}
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-texter-indigo" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div>
            {!collapsed && (
              <p className="px-2 mb-2 text-[10px] font-semibold text-texter-text-dim uppercase tracking-wider font-mono">
                Configuración & Reglas
              </p>
            )}
            <nav className="space-y-1">
              {secondaryNav.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onCloseMobile}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group select-none relative",
                      isActive
                        ? "bg-texter-indigo/15 text-white border border-indigo-500/30"
                        : "text-texter-text-secondary hover:text-white hover:bg-texter-surface-hover border border-transparent"
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <Icon className="w-5 h-5 shrink-0 text-texter-text-muted group-hover:text-texter-text-primary" />
                    {!collapsed && (
                      <span className="truncate flex-1">{item.name}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {!collapsed && (
            <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-texter-text-secondary font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-texter-cyan" />
                  Cluster NEXTEХ
                </span>
                <span className="w-2 h-2 rounded-full bg-texter-emerald animate-pulse" />
              </div>
              <div className="space-y-1 font-mono text-[11px] text-texter-text-muted">
                <div className="flex justify-between">
                  <span>Conexión:</span>
                  <span className="text-emerald-400">Óptima (410ms)</span>
                </div>
                <div className="flex justify-between">
                  <span>Orquestación:</span>
                  <span className="text-cyan-400">OmniEngine</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-texter-border bg-texter-surface-subtle/50">
          <div
            className={cn(
              "flex items-center gap-3 p-2 rounded-xl hover:bg-texter-surface-hover transition-colors",
              collapsed ? "justify-center" : "justify-between"
            )}
          >
            <Link
              href="/settings"
              className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-90"
              title="Ver perfil y configuración"
            >
              <div className="w-8 h-8 rounded-lg bg-texter-surface border border-texter-border flex items-center justify-center font-mono font-semibold text-xs text-texter-indigo shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-white truncate">
                      {displayName}
                    </p>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-texter-surface border border-texter-border text-texter-cyan">
                      {userPlan}
                    </span>
                  </div>
                  <p className="text-[10px] text-texter-text-muted truncate font-mono">
                    {displayEmail}
                  </p>
                </div>
              )}
            </Link>

            {!collapsed && (
              <button
                onClick={handleSignOut}
                disabled={isLoggingOut}
                className="p-1.5 text-texter-text-muted hover:text-texter-rose transition-colors rounded-lg hover:bg-texter-surface"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                {isLoggingOut ? (
                  <Loader2 className="w-4 h-4 animate-spin text-texter-rose" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
