/**
 * NEXTEХ Omnichannel Gateway — Webhook Entrante WhatsApp Cloud API (WA-1)
 *
 * Variables de entorno requeridas:
 * - WHATSAPP_VERIFY_TOKEN: Token configurado en el panel de desarrolladores de Meta para verificar el webhook.
 * - WHATSAPP_APP_SECRET: Secreto de la aplicación Meta para validar la firma HMAC-SHA256 (header x-hub-signature-256).
 *
 * URL del webhook para configurar en Meta App Dashboard:
 * https://nextex-seven.vercel.app/api/webhooks/whatsapp
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";
import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { getCachedResponse, setCachedResponse } from "@/lib/efficiency/cache";
import { logTokenUsage } from "@/lib/efficiency/usage";

export const dynamic = "force-dynamic";

/**
 * 1. GET: Verificación de Meta Webhook (hub.challenge)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  // BAJO 2026-10-28: comparación en tiempo constante (antes ===).
  const tokenMatches =
    !!token &&
    !!expectedToken &&
    token.length === expectedToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));

  if (mode === "subscribe" && expectedToken && tokenMatches) {
    return new NextResponse(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Valida la firma HMAC-SHA256 enviada por Meta en el header x-hub-signature-256.
 * Utiliza comparación en tiempo constante (timingSafeEqual) para mitigar timing attacks.
 */
function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const providedSignatureHex = signatureHeader.slice(7).trim();
  const hmac = createHmac("sha256", appSecret);
  hmac.update(rawBody, "utf8");
  const expectedSignatureHex = hmac.digest("hex");

  if (providedSignatureHex.length !== expectedSignatureHex.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(providedSignatureHex, "hex"),
      Buffer.from(expectedSignatureHex, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * 2. POST: Procesamiento de mensajes entrantes de WhatsApp Cloud API
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET || "";

  // 1. Verificación de firma: si falla → 401
  if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    return NextResponse.json(
      { error: "Firma inválida o ausente" },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const phoneNumberId = value?.metadata?.phone_number_id || value?.phone_number_id;
  const messages = value?.messages;

  // Si no hay mensajes o es un evento de estado (sent, delivered, read), responder 200 inmediatamente
  if (!phoneNumberId || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const serviceClient = createServiceClient();

  // a. Resolver cliente: buscar en client_integrations donde blueprint_slug='whatsapp-bot', is_active=true
  const { data: integrations, error: intErr } = await (serviceClient.from("client_integrations") as any)
    .select(`
      id,
      client_id,
      encrypted_credentials,
      client:clients (
        id,
        display_name,
        workspace_id,
        status
      )
    `)
    .eq("blueprint_slug", "whatsapp-bot")
    .eq("is_active", true);

  if (intErr || !integrations || integrations.length === 0) {
    console.warn("[WhatsApp Webhook] No hay integraciones de whatsapp-bot activas registradas.");
    return NextResponse.json({ ok: true });
  }

  let matchingClient: any = null;
  let matchingCredentials: any = null;

  for (const item of integrations) {
    if (!item.encrypted_credentials) continue;
    try {
      const credsPayload =
        typeof item.encrypted_credentials === "string"
          ? JSON.parse(item.encrypted_credentials)
          : item.encrypted_credentials;

      const aad = `nextex:client-integration:${item.client_id}:whatsapp-bot`;
      const decryptedJson = SecretVault.decryptSecret(
        aad,
        credsPayload.encryptedSecret,
        credsPayload.iv,
        credsPayload.authTag
      );
      const creds = JSON.parse(decryptedJson);

      if (String(creds.phone_number_id).trim() === String(phoneNumberId).trim()) {
        matchingClient = item.client;
        matchingCredentials = creds;
        break;
      }
    } catch (decErr) {
      console.error("[WhatsApp Webhook] Error al descifrar credenciales de integración:", decErr);
    }
  }

  // b. Si no hay cliente → log y continuar (responder 200 para que Meta no reintente)
  if (!matchingClient || matchingClient.status === "inactive" || !matchingClient.workspace_id) {
    console.warn(`[WhatsApp Webhook] No se encontró cliente activo para phone_number_id: ${phoneNumberId}`);
    return NextResponse.json({ ok: true });
  }

  const clientId = matchingClient.id;
  const workspaceId = matchingClient.workspace_id;
  const businessName = matchingClient.display_name || "la empresa";
  const apiToken =
    matchingCredentials?.api_token || matchingCredentials?.access_token || matchingCredentials?.token;

  const contacts = value?.contacts;
  const contactName =
    Array.isArray(contacts) && contacts[0]?.profile?.name ? contacts[0].profile.name : null;

  // Procesar mensajes de tipo 'text'
  for (const msg of messages) {
    if (msg.type !== "text" || !msg.text?.body) continue;

    const from = String(msg.from).trim();
    const messageText = String(msg.text.body).trim();
    if (!from || !messageText) continue;

    const nowIso = new Date().toISOString();

    // c. Buscar o crear conversación (client_id, channel='whatsapp', external_chat_id=<from>)
    let conversation: any = null;
    const { data: existingConv } = await (serviceClient.from("conversations") as any)
      .select("id, status")
      .eq("client_id", clientId)
      .eq("channel", "whatsapp")
      .eq("external_chat_id", from)
      .maybeSingle();

    if (existingConv) {
      conversation = existingConv;
    } else {
      const { data: newConv } = await (serviceClient.from("conversations") as any)
        .insert({
          client_id: clientId,
          channel: "whatsapp",
          external_chat_id: from,
          visitor_name: contactName || from,
          status: "bot",
          last_message_at: nowIso,
        })
        .select("id, status")
        .single();
      conversation = newConv;
    }

    if (!conversation?.id) continue;

    // d. Guardar mensaje role='visitor'
    await (serviceClient.from("conversation_messages") as any).insert({
      conversation_id: conversation.id,
      role: "visitor",
      content: messageText,
      created_at: nowIso,
    });

    await (serviceClient.from("conversations") as any)
      .update({ last_message_at: nowIso, updated_at: nowIso })
      .eq("id", conversation.id);

    // e. Si status='human' → no responder (el humano lo ve en la bandeja)
    if (conversation.status === "human") {
      continue;
    }

    // f. Si status='bot' → ejecutar el agente del workspace del cliente con el texto
    try {
      // EFIC-2: Consulta de caché de respuestas
      const cachedHit = await getCachedResponse(workspaceId, messageText);
      let replyText = cachedHit?.response;
      const modelName = "gemini-1.5-flash";

      if (!replyText) {
        const { data: wsRecord } = await (serviceClient.from("workspaces") as any)
          .select("id, owner_id")
          .eq("id", workspaceId)
          .maybeSingle();

        const executionUserId = wsRecord?.owner_id || "00000000-0000-0000-0000-000000000000";

        const systemPrompt = `Eres el asistente virtual oficial de "${businessName}" en WhatsApp.
Tu objetivo es responder de manera atenta, clara, profesional, concisa y amigable a los mensajes de los clientes.
Responde en el mismo idioma del usuario (por defecto español). Mantén las respuestas breves y legibles para WhatsApp. Nunca inventes información confidencial ni enlaces no verificados.`;

        const aiResponse = await defaultAIGateway.execute(
          {
            requestId: `req-wa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            workspaceId,
            userId: executionUserId,
            conversationId: from,
            model: modelName,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: messageText },
            ],
            options: {
              maxTokens: 1000,
            },
          },
          serviceClient
        );

        replyText = aiResponse.content;

        // Guardar en caché y registrar consumo de tokens
        await setCachedResponse(workspaceId, messageText, replyText, modelName);

        const inputTokens = aiResponse.usage?.inputTokens || Math.ceil(messageText.length / 4);
        const outputTokens = aiResponse.usage?.outputTokens || Math.ceil(replyText.length / 4);

        await logTokenUsage({
          clientId,
          workspaceId,
          conversationId: conversation.id,
          model: modelName,
          inputTokens,
          outputTokens,
        });
      }

      if (replyText && apiToken) {
        // Enviar respuesta por POST a Meta WhatsApp Cloud API v19.0
        const sendRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: { body: replyText },
          }),
        });

        if (!sendRes.ok) {
          const errText = await sendRes.text().catch(() => "");
          console.error(`[WhatsApp Webhook] Error al enviar mensaje vía Meta (${sendRes.status}):`, errText);
        }

        // Guardar mensaje role='bot'
        const botReplyTime = new Date().toISOString();
        await (serviceClient.from("conversation_messages") as any).insert({
          conversation_id: conversation.id,
          role: "bot",
          content: replyText,
          created_at: botReplyTime,
        });

        await (serviceClient.from("conversations") as any)
          .update({ last_message_at: botReplyTime, updated_at: botReplyTime })
          .eq("id", conversation.id);
      }
    } catch (botErr) {
      console.error("[WhatsApp Webhook] Error procesando respuesta del bot:", botErr);
    }
  }

  // Siempre responder 200 rápido a Meta
  return NextResponse.json({ ok: true });
}
