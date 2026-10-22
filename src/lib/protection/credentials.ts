import { SupabaseClient } from "@supabase/supabase-js";
import { sendVigiaAlert } from "@/lib/vigia/notify";

export type CredentialStatus = "expired" | "warning" | "ok" | "no_expiry";

export interface CredentialRecord {
  id: string;
  client_id?: string | null;
  name: string;
  provider: "github" | "vercel" | "supabase" | "meta" | "google" | "openai" | "otro";
  location?: string | null;
  expires_at?: string | null;
  alert_days_before: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  days_left?: number | null;
  status?: CredentialStatus;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

/**
 * Calcula los días restantes para el vencimiento de una credencial.
 * - Si expiresAt es nulo o inválido, retorna null.
 * - Retorna un entero (negativo si ya venció, 0 si vence hoy, positivo si vence en el futuro).
 */
export function calculateDaysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const parts = String(expiresAt).split("-").map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return null;
  }
  const [year, month, day] = parts;
  const expUtc = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expUtc - todayUtc) / (1000 * 60 * 60 * 24));
}

/**
 * Determina el estado de vencimiento según los días restantes y alert_days_before.
 * - 'expired': days_left < 0
 * - 'warning': days_left <= alert_days_before
 * - 'ok': days_left > alert_days_before
 * - 'no_expiry': sin fecha definida
 */
export function computeCredentialStatus(
  daysLeft: number | null,
  alertDaysBefore: number = 7
): CredentialStatus {
  if (daysLeft === null) {
    return "no_expiry";
  }
  if (daysLeft < 0) {
    return "expired";
  }
  if (daysLeft <= alertDaysBefore) {
    return "warning";
  }
  return "ok";
}

export interface CheckExpirationsResult {
  checked: number;
  alerted: number;
  skipped: number;
  details: Array<{
    id: string;
    name: string;
    expires_at: string;
    days_left: number;
    alerted: boolean;
    reason?: string;
  }>;
}

/**
 * NEXTEХ Bóveda de Credenciales — Chequeo de Vencimientos (NIV1-2)
 *
 * Busca credenciales con expires_at <= hoy + alert_days_before.
 * Para cada una:
 * 1. Verifica si NO existe incident_log kind 'credential_alert' con:
 *    detail->>'credential_id' = su id Y detail->>'expires_at' = su fecha actual.
 * 2. Si no existe: envía alerta vía Telegram (sendVigiaAlert).
 *    Título: "🔑 Credencial por vencer"
 *    Cuerpo: nombre, proveedor, dónde vive y fecha ("vence el <fecha>" o "VENCIÓ el <fecha>").
 * 3. Registra el incident_log SOLO si la alerta se envió de verdad.
 *    (Si Telegram no está configurado o falla, no se registra para intentar luego).
 * 4. Dedup por (credencial, fecha): si se renueva (cambia expires_at), vuelve a alertar.
 */
export async function checkCredentialExpirations(
  supabase?: SupabaseClient | any
): Promise<CheckExpirationsResult> {
  let client = supabase;
  if (!client) {
    const { createServiceClient } = await import("@/lib/supabase/server");
    client = createServiceClient();
  }
  const result: CheckExpirationsResult = {
    checked: 0,
    alerted: 0,
    skipped: 0,
    details: [],
  };

  try {
    // 1. Obtener todas las credenciales que tienen fecha de vencimiento definida
    const { data: credentials, error: credErr } = await (client.from("credentials_inventory") as any)
      .select("*")
      .not("expires_at", "is", null);

    if (credErr) {
      console.error("[PROTECCIÓN CREDENCIALES] Error al consultar credentials_inventory:", credErr);
      return result;
    }

    if (!Array.isArray(credentials) || credentials.length === 0) {
      return result;
    }

    result.checked = credentials.length;

    // 2. Obtener el historial previo de incident_log kind 'credential_alert'
    const { data: existingIncidents, error: incErr } = await (client.from("incident_log") as any)
      .select("id, detail")
      .eq("kind", "credential_alert");

    if (incErr) {
      console.warn("[PROTECCIÓN CREDENCIALES] Error al consultar incident_log:", incErr);
    }

    const pastAlerts = Array.isArray(existingIncidents) ? existingIncidents : [];

    // 3. Evaluar cada credencial
    for (const cred of credentials) {
      const daysLeft = calculateDaysLeft(cred.expires_at);
      if (daysLeft === null) continue;

      const alertDays =
        typeof cred.alert_days_before === "number" && !isNaN(cred.alert_days_before)
          ? cred.alert_days_before
          : 7;

      // Condición: expires_at <= hoy + alert_days_before (es decir, daysLeft <= alertDays)
      if (daysLeft > alertDays) {
        continue;
      }

      // 4. Comprobar si ya existe alerta previa para este par (credential_id, expires_at)
      const alreadyAlerted = pastAlerts.some((row: any) => {
        const detail = row.detail;
        if (!detail) return false;
        return (
          String(detail.credential_id) === String(cred.id) &&
          String(detail.expires_at) === String(cred.expires_at)
        );
      });

      if (alreadyAlerted) {
        result.skipped++;
        result.details.push({
          id: cred.id,
          name: cred.name,
          expires_at: cred.expires_at,
          days_left: daysLeft,
          alerted: false,
          reason: "Alerta ya enviada previamente para este vencimiento",
        });
        continue;
      }

      // 5. Formatear mensaje de alerta
      const isExpired = daysLeft < 0;
      const datePhrase = isExpired ? `VENCIÓ el ${cred.expires_at}` : `vence el ${cred.expires_at}`;
      const locationText = cred.location && String(cred.location).trim() ? cred.location.trim() : "No especificada";

      const title = "🔑 Credencial por vencer";
      const bodyLines = [
        `Credencial: ${cred.name}`,
        `Proveedor: ${cred.provider}`,
        `Dónde vive: ${locationText}`,
        `Fecha: ${datePhrase}`,
      ];

      if (cred.notes && String(cred.notes).trim()) {
        bodyLines.push(`Notas: ${cred.notes.trim()}`);
      }

      const body = bodyLines.join("\n");

      // 6. Enviar alerta mediante sendVigiaAlert (force: true para evitar colisión de anti-ruido horario)
      const sent = await sendVigiaAlert(title, body, { force: true });

      // 7. Registrar incident_log SOLO si la alerta se envió de verdad
      if (sent) {
        try {
          await (client.from("incident_log") as any).insert({
            client_id: cred.client_id || null,
            kind: "credential_alert",
            title: `🔑 Credencial por vencer: ${cred.name}`,
            detail: {
              credential_id: cred.id,
              expires_at: cred.expires_at,
              name: cred.name,
              provider: cred.provider,
              location: cred.location || null,
              days_left: daysLeft,
              date_phrase: datePhrase,
              alerted: true,
              channel: "telegram",
              sent_at: new Date().toISOString(),
            },
          });
          result.alerted++;
          result.details.push({
            id: cred.id,
            name: cred.name,
            expires_at: cred.expires_at,
            days_left: daysLeft,
            alerted: true,
          });
        } catch (logInsertErr: any) {
          console.error(
            "[PROTECCIÓN CREDENCIALES] Error al insertar incident_log tras alerta:",
            logInsertErr
          );
        }
      } else {
        result.skipped++;
        result.details.push({
          id: cred.id,
          name: cred.name,
          expires_at: cred.expires_at,
          days_left: daysLeft,
          alerted: false,
          reason: "Telegram no configurado o error en envío de alerta",
        });
      }
    }
  } catch (err: any) {
    console.error("[PROTECCIÓN CREDENCIALES] Excepción en checkCredentialExpirations:", err);
  }

  return result;
}
