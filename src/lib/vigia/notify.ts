import { SupabaseClient } from "@supabase/supabase-js";

export interface AlertOptions {
  clientId?: string;
  kind?: string;
  force?: boolean;
}

export interface SendAlertResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * NEXTEХ VIGÍA — Notificador y Canal de Alertas a Telegram (VIG-6)
 *
 * Envía mensajes de alerta a Telegram con protección anti-ruido:
 * - Si TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no existen: no-op silencioso con log.
 * - Anti-ruido: antes de enviar, revisa incident_log. Si ya se envió una alerta
 *   del mismo 'kind' para el mismo cliente en la última hora, se omite (salvo force = true).
 * - Registra la alerta en incident_log con alerted: true para alimentar el anti-ruido.
 * - NUNCA lanza excepción.
 */
export async function sendVigiaAlert(
  title: string,
  body: string,
  options?: AlertOptions,
  supabase?: SupabaseClient
): Promise<SendAlertResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    console.log(
      "[VIGÍA TELEGRAM] Telegram no configurado (falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID)"
    );
    return {
      sent: false,
      skipped: true,
      reason: "Telegram no configurado",
    };
  }

  // 1. Anti-ruido: verificar si ya se alertó este evento para este cliente en la última hora
  if (supabase && options?.clientId && options?.kind && !options?.force) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentAlerts } = await (supabase.from("incident_log") as any)
        .select("id, detail")
        .eq("client_id", options.clientId)
        .eq("kind", options.kind)
        .gte("created_at", oneHourAgo);

      const alreadyAlerted =
        Array.isArray(recentAlerts) &&
        recentAlerts.some((row: any) => row.detail?.alerted === true);

      if (alreadyAlerted) {
        return {
          sent: false,
          skipped: true,
          reason: "Anti-ruido activo: ya se alertó este evento en la última hora",
        };
      }
    } catch (err: any) {
      console.warn(
        "[VIGÍA TELEGRAM] Error verificando anti-ruido en incident_log:",
        err?.message || err
      );
    }
  }

  // 2. Despachar a Telegram API
  try {
    const text = `${title}\n\n${body}`.trim();
    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        `[VIGÍA TELEGRAM] Error devuelto por Telegram API (HTTP ${res.status}):`,
        errText
      );
      return { sent: false, reason: `HTTP ${res.status}: ${errText}` };
    }

    // 3. Registrar en incident_log que se emitió la alerta
    if (supabase && options?.clientId && options?.kind) {
      try {
        await (supabase.from("incident_log") as any).insert({
          client_id: options.clientId,
          kind: options.kind,
          title: `Alerta Telegram: ${title}`,
          detail: {
            alert_title: title,
            alert_body: body,
            alerted: true,
            channel: "telegram",
            sent_at: new Date().toISOString(),
          },
        });
      } catch (logErr: any) {
        console.warn(
          "[VIGÍA TELEGRAM] Error registrando alerta en incident_log:",
          logErr?.message || logErr
        );
      }
    }

    return { sent: true };
  } catch (err: any) {
    console.error(
      "[VIGÍA TELEGRAM] Error de red al comunicar con Telegram:",
      err?.message || err
    );
    return { sent: false, reason: err?.message || "Error de red" };
  }
}
