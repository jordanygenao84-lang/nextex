"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-texter-bg/80 backdrop-blur-xl border-b border-texter-border/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="hover:opacity-90 transition-opacity">
          <Logo variant="full" size="sm" showTagline={false} />
        </Link>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-6 text-sm text-texter-text-secondary font-medium">
          <a href="#pipeline" className="hover:text-white transition-colors">
            Pipeline Autónomo
          </a>
          <a href="#capacidades" className="hover:text-white transition-colors">
            Capacidades
          </a>
          <a href="#arquitectura" className="hover:text-white transition-colors">
            Arquitectura
          </a>
          <a href="#seguridad" className="hover:text-white transition-colors flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-texter-emerald" />
            Seguridad & RLS
          </a>
        </div>

        {/* Desktop Auth Buttons */}
        <div className="hidden sm:flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Iniciar Sesión
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button
              variant="primary"
              size="sm"
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Abrir Dashboard
            </Button>
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-texter-text-muted hover:text-white md:hidden"
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-texter-surface border-b border-texter-border px-4 py-6 space-y-4">
          <div className="flex flex-col space-y-3 text-sm text-texter-text-secondary font-medium">
            <a
              href="#pipeline"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white"
            >
              Pipeline Autónomo
            </a>
            <a
              href="#capacidades"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white"
            >
              Capacidades
            </a>
            <a
              href="#arquitectura"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white"
            >
              Arquitectura
            </a>
          </div>
          <div className="pt-4 border-t border-texter-border flex flex-col gap-2">
            <Link href="/login" className="w-full">
              <Button variant="secondary" size="md" className="w-full justify-center">
                Iniciar Sesión
              </Button>
            </Link>
            <Link href="/dashboard" className="w-full">
              <Button variant="primary" size="md" className="w-full justify-center">
                Abrir Dashboard
              </Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};
