/**
 * NEXTEХ Agent Core — Herramienta Nativa: Canal WhatsApp (Fase 4.12)
 * Despacho transaccional de notificaciones y recordatorios por WhatsApp.
 * Soporta Meta WhatsApp Cloud API, Twilio WhatsApp y modo auditado resiliente.
 */

import { ToolExecutionContext } from "../types";

export interface WhatsAppParams {
  phone: string;
  message: string;
}

export interface WhatsAppResult {
  phone: string;
  message: string;
  status: "delivered" | "queued" | "simulated";
  provider: "meta_cloud_api" | "twilio" | "local_audit";
  messageId: string;
  deliveredAt: string;
}

/**
 * Normaliza y valida números telefónicos a formato internacional E.164.
 * Admite formatos como: +18091234567, 18091234567, 8091234567 (agrega prefijo DR/US por defecto).
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== "string") {
    throw new Error("El número de teléfono es obligatorio y debe ser una cadena.");
  }

  // Eliminar espacios, guiones, paréntesis y caracteres no numéricos excepto '+'
  let clean = rawPhone.trim().replace(/[\s\-()]/g, "");

  if (!clean.startsWith("+")) {
    // Si tiene 10 dígitos (ej. 8091234567 República Dominicana / EE.UU.) anteponer +1
    if (/^\d{10}$/.test(clean)) {
      clean = `+1${clean}`;
    } else if (/^\d{11}$/.test(clean) && clean.startsWith("1")) {
      clean = `+${clean}`;
    } else {
      clean = `+${clean}`;
    }
  }

  // Validación E.164 básica (+ seguido de 8 a 15 dígitos)
  if (!/^\+[1-9]\d{7,14}$/.test(clean)) {
    throw new Error(`Número de teléfono inválido '${rawPhone}'. Debe seguir el formato E.164 (ej. +1809XXXXXXX).`);
  }

  return clean;
}

/**
 * Handler formal de la herramienta whatsapp para el ToolRegistry de NEXTEХ.
 */
export async function whatsappToolHandler(
  params: Record<string, any>,
  context: ToolExecutionContext
): Promise<{ result: WhatsAppResult; metadata: Record<string, any> }> {
  const rawPhone = params.phone || params.to || params.recipient;
  const message = params.message || params.text || params.body;

  if (!rawPhone) {
    throw new Error("Parámetro 'phone' requerido para la herramienta whatsapp.");
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("Parámetro 'message' requerido y no puede estar vacío.");
  }

  const phone = normalizePhoneNumber(rawPhone);
  const trimmedMessage = message.trim();
  const timestamp = new Date().toISOString();

  // 1. Detección de Proveedor Configurado: Meta WhatsApp Cloud API
  const metaToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (metaToken && metaPhoneId) {
    try {
      const cleanTo = phone.replace("+", "");
      const res = await fetch(`https://graph.facebook.com/v21.0/${metaPhoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${metaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanTo,
          type: "text",
          text: {
            preview_url: false,
            body: trimmedMessage,
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.text();
        throw new Error(`Fallo en Meta Cloud API (${res.status}): ${errData.slice(0, 150)}`);
      }

      const metaRes = await res.json();
      const messageId = metaRes?.messages?.[0]?.id || `meta-${Date.now()}`;

      return {
        result: {
          phone,
          message: trimmedMessage,
          status: "delivered",
          provider: "meta_cloud_api",
          messageId,
          deliveredAt: timestamp,
        },
        metadata: {
          workspace_id: context.workspaceId,
          run_id: context.runId,
          providerResponse: metaRes,
        },
      };
    } catch (apiErr: any) {
      throw new Error(`Error despachando WhatsApp vía Meta Cloud API: ${apiErr?.message}`);
    }
  }

  // 2. Detección de Proveedor: Twilio WhatsApp
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM;

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const fromNumber = twilioFrom.startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`;
      const toNumber = `whatsapp:${phone}`;

      const formData = new URLSearchParams();
      formData.append("From", fromNumber);
      formData.append("To", toNumber);
      formData.append("Body", trimmedMessage);

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const basicAuth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64");

      const res = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const errData = await res.text();
        throw new Error(`Fallo en Twilio API (${res.status}): ${errData.slice(0, 150)}`);
      }

      const twilioRes = await res.json();
      const messageId = twilioRes?.sid || `tw-${Date.now()}`;

      return {
        result: {
          phone,
          message: trimmedMessage,
          status: "queued",
          provider: "twilio",
          messageId,
          deliveredAt: timestamp,
        },
        metadata: {
          workspace_id: context.workspaceId,
          run_id: context.runId,
          providerResponse: twilioRes,
        },
      };
    } catch (twErr: any) {
      throw new Error(`Error despachando WhatsApp vía Twilio: ${twErr?.message}`);
    }
  }

  // 3. Modo Auditado Resiliente (Entorno Local / Staging sin credenciales directas de mensajería)
  const simulatedMessageId = `sim-wa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    result: {
      phone,
      message: trimmedMessage,
      status: "simulated",
      provider: "local_audit",
      messageId: simulatedMessageId,
      deliveredAt: timestamp,
    },
    metadata: {
      workspace_id: context.workspaceId,
      run_id: context.runId,
      note: "Mensaje procesado en modo auditado. Para entrega física a WhatsApp, configure WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID o credenciales Twilio en Vercel.",
    },
  };
}
