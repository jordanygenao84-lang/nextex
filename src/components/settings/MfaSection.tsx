"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, AlertCircle, CheckCircle2, Copy, Check, Trash2 } from "lucide-react";

type TotpFactor = {
  id: string;
  friendlyName?: string;
  factorType: string;
  status: string;
  createdAt?: string;
};

// Segundo factor TOTP opt-in (SEC-002). Sin factores, el login no cambia.
// Con un factor verificado, el login y el middleware exigen el código TOTP
// (el reto vive en /mfa-challenge). La inscripción la hace el propio
// usuario con su app autenticadora; NUNCA se inicia un registro en nombre
// de otro usuario: un factor pendiente sin verificar bloquea el siguiente
// intento en GoTrue.
export default function MfaSection() {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [friendlyName, setFriendlyName] = useState("nextex");
  const [enrolling, setEnrolling] = useState(false);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmUnenrollId, setConfirmUnenrollId] = useState<string | null>(null);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setError("No se pudieron cargar los factores de seguridad.");
        return;
      }
      const totp = (data?.totp || []).map((f: any) => ({
        id: f.id,
        friendlyName: f.friendly_name,
        factorType: f.factor_type,
        status: f.status,
        createdAt: f.created_at,
      }));
      setFactors(totp);
    } catch {
      setError("No se pudieron cargar los factores de seguridad.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const copyText = async (kind: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 2500);
  };

  const startEnroll = async () => {
    setError(null);
    setNotice(null);
    setEnrolling(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: friendlyName.trim() || "nextex",
      });
      if (error || !data?.id || !data?.totp) {
        setError("No se pudo iniciar el registro. Inténtalo de nuevo.");
        return;
      }
      setPendingFactorId(data.id);
      setTotpSecret(data.totp.secret);
      setTotpUri(data.totp.uri);
      setNotice(
        "Registro iniciado. Escribe el secreto a mano en tu app autenticadora y verifica el código ahora mismo: si cierras sin verificar, el registro queda pendiente y puede bloquear un nuevo intento."
      );
    } catch {
      setError("No se pudo iniciar el registro. Inténtalo de nuevo.");
    } finally {
      setEnrolling(false);
    }
  };

  const cancelPendingEnroll = async () => {
    if (!pendingFactorId) return;
    try {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
    } catch {
      // El factor pendiente se ignora al recargar; el usuario puede reintentar.
    }
    setPendingFactorId(null);
    setTotpSecret(null);
    setTotpUri(null);
    setCode("");
    setNotice(null);
    loadFactors();
  };

  const verifyEnroll = async () => {
    if (!pendingFactorId || code.trim().length !== 6) {
      setError("Escribe el código de 6 dígitos de tu app autenticadora.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: pendingFactorId,
      });
      if (challengeError || !challenge?.id) {
        setError("No se pudo verificar el código. Inténtalo de nuevo.");
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: pendingFactorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError("Código incorrecto o vencido. Inténtalo de nuevo.");
        return;
      }
      setPendingFactorId(null);
      setTotpSecret(null);
      setTotpUri(null);
      setCode("");
      setNotice("Segundo factor activado. A partir de ahora tu login pedirá el código TOTP.");
      loadFactors();
    } catch {
      setError("No se pudo verificar el código. Inténtalo de nuevo.");
    } finally {
      setVerifying(false);
    }
  };

  const unenroll = async (factorId: string) => {
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        setError("No se pudo eliminar el factor. Inténtalo de nuevo.");
        return;
      }
      setConfirmUnenrollId(null);
      setNotice("Factor eliminado. Tu login ya no pedirá el código TOTP.");
      loadFactors();
    } catch {
      setError("No se pudo eliminar el factor. Inténtalo de nuevo.");
    }
  };

  const verified = factors.filter((f) => f.status === "verified");
  const unverified = factors.filter((f) => f.status !== "verified");

  return (
    <Card variant="elevated" padding="lg">
      <div className="flex items-center justify-between pb-4 border-b border-texter-border mb-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-texter-emerald" />
            Segundo factor (TOTP)
          </h2>
          <p className="text-xs text-texter-text-muted mt-0.5">
            Opcional. Al activar un factor verificado, tu login pedirá el código de tu app autenticadora.
          </p>
        </div>
        <span className="text-xs font-mono text-texter-text-muted">
          {verified.length > 0 ? `${verified.length} activo(s)` : "Sin activar"}
        </span>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2 mb-4">
          <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-texter-text-muted">Cargando factores…</p>
      ) : (
        <div className="space-y-4">
          {verified.length > 0 && (
            <div className="space-y-2">
              {verified.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-xl bg-texter-surface-subtle border border-texter-border px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-semibold text-white">{f.friendlyName || "TOTP"}</p>
                    <p className="text-[11px] text-texter-text-muted font-mono">Verificado</p>
                  </div>
                  {confirmUnenrollId === f.id ? (
                    <span className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => unenroll(f.id)} className="text-xs text-rose-400">
                        Confirmar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmUnenrollId(null)} className="text-xs">
                        Cancelar
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmUnenrollId(f.id)}
                      className="text-xs text-texter-text-dim hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {unverified.length > 0 && (
            <p className="text-xs text-amber-300">
              Tienes {unverified.length} factor(es) sin verificar. Elimínalos desde tu app autenticadora o reintenta el
              registro: un factor pendiente puede bloquear un nuevo intento.
            </p>
          )}

          {!pendingFactorId ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 w-full">
                <Input
                  label="Nombre del factor"
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  placeholder="nextex"
                />
              </div>
              <Button variant="primary" size="md" onClick={startEnroll} isLoading={enrolling}>
                Activar segundo factor
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl bg-texter-surface-subtle border border-texter-border p-4">
              <p className="text-xs font-semibold text-white">Completa el registro ahora (no lo dejes pendiente)</p>
              {totpSecret && (
                <div className="space-y-1">
                  <p className="text-[11px] text-texter-text-muted">Secreto (escríbelo a mano en tu app autenticadora):</p>
                  <p className="text-xs font-mono text-white break-all bg-texter-surface px-3 py-2 rounded-lg border border-texter-border">
                    {totpSecret}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => copyText("secret", totpSecret)} className="text-xs">
                      {copied === "secret" ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                      {copied === "secret" ? "¡Copiado!" : "Copiar secreto"}
                    </Button>
                    {totpUri && (
                      <Button variant="ghost" size="sm" onClick={() => copyText("uri", totpUri)} className="text-xs">
                        {copied === "uri" ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                        {copied === "uri" ? "¡Copiado!" : "Copiar URI otpauth"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                <div className="flex-1 w-full">
                  <Input
                    label="Código de 6 dígitos"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                  />
                </div>
                <Button variant="primary" size="md" onClick={verifyEnroll} isLoading={verifying}>
                  Verificar y activar
                </Button>
                <Button variant="ghost" size="md" onClick={cancelPendingEnroll}>
                  Cancelar registro
                </Button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-texter-text-dim">
            Si pierdes tu app autenticadora, el factor solo se puede borrar con la llave service_role de Supabase
            (borrado de factor por API de administración). Guarda tu secreto en un lugar seguro.
          </p>
        </div>
      )}
    </Card>
  );
}
