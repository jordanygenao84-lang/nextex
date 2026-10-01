import React from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-texter-border bg-texter-surface-subtle/50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pb-8 border-b border-texter-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Logo variant="full" size="sm" showTagline={true} />
            <span className="hidden sm:inline text-texter-border">|</span>
            <span className="text-xs text-texter-text-muted">
              Una plataforma desarrollada por <strong className="text-white font-medium">Nexora Texter</strong>
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-texter-text-secondary">
            <Link href="/login" className="hover:text-white transition-colors">
              Iniciar Sesión
            </Link>
            <Link href="/register" className="hover:text-white transition-colors">
              Crear Cuenta
            </Link>
            <Link href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/chat" className="hover:text-white transition-colors">
              Espacio de Chat
            </Link>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-texter-text-dim font-mono">
          <p>© 2026 Nexora Texter. Todos los derechos reservados.</p>
          <p>
            Infraestructura oficial: GitHub • Vercel • Supabase (Jordanygenao84@gmail.com)
          </p>
        </div>
      </div>
    </footer>
  );
};
