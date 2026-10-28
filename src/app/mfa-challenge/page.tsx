"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, AlertCircle } from "lucide-react";

// Reto TOTP tras el login con contraseña, cuando el usuario tiene un
// factor verificado (nextLevel aal2, sesión actual aal1). Esta página no
// está en las rutas protegidas del middleware para no crear un bucle.
export default function MfaChallengePage() {
  const router = useRouter();
  const [redirectPath, setRedirectPath] = useState("/dashboard");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [needsChallenge, setNeedsChallenge] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    if (redirect && redirect.startsWith("/")) {
      setRedirectPath(redirect);
    }
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsChallenge(false);
        return;
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aal || aal.currentLevel === aal.nextLevel) {
        setNeedsChallenge(false);
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp || []).find((f: any) => f.status === "verified");
      if (!verified) {
        setNeedsChallenge(false);
        return;
      }
      setFactorId(verified.id);
      setNeedsChallenge(true);
    })();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.trim().length !== 6) {
      setError("Escribe el código de 6 dígitos de tu app autenticadora.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError || !challenge?.id) {
        setError("No se pudo verificar el código. Inténtalo de nuevo.");
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError("Código incorrecto o vencido. Inténtalo de nuevo.");
        return;
      }
      router.push(redirectPath);
      router.refresh();
    } catch {
      setError("No se pudo verificar el código. Inténtalo de nuevo.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-texter-bg flex flex-col justify-center items-center p-4 sm:p-6">
      <Link href="/" className="mb-8 hover:opacity-90">
        <Logo variant="full" size="lg" showTagline={true} />
      </Link>
      <div className="w-full max-w-md">
        <Card variant="elevated" padding="lg">
          <div className="text-center space-y-1.5 mb-6">
            <h1 className="text-xl font-bold text-white flex items-center justify-center gap-2">
              <ShieldCheck className="w-5 h-5 text-texter-emerald" />
              Verificación en dos pasos
            </h1>
            <p className="text-xs text-texter-text-muted">
              Tu cuenta tiene el segundo factor activado. Escribe el código de tu app autenticadora.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2 mb-4">
              <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {needsChallenge === null ? (
            <p className="text-xs text-texter-text-muted text-center">Comprobando tu sesión…</p>
          ) : needsChallenge === false ? (
            <div className="space-y-4 text-center">
              <p className="text-xs text-texter-text-muted">
                No necesitas completar un reto ahora mismo (sin sesión o sin factor verificado).
              </p>
              <div className="flex justify-center gap-2">
                <Link href="/login">
                  <Button variant="secondary" size="md">
                    Ir a login
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="primary" size="md">
                    Ir al panel
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <Input
                label="Código de 6 dígitos"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
              />
              <Button variant="primary" size="md" type="submit" isLoading={verifying} className="w-full">
                Verificar
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
