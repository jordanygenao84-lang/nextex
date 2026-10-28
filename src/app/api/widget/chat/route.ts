import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { getCachedResponse, setCachedResponse } from "@/lib/efficiency/cache";
import { logTokenUsage } from "@/lib/efficiency/usage";
import { isClientServiceActive } from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Rate Limiter en memoria: max 30 mensajes por minuto por (embed_key + IP)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (entry.count >= 30) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * POST /api/widget/chat
 * Endpoint público para que los visitantes conversen con el agente del cliente.
 * SEGURIDAD CRÍTICA: Resuelve el workspace_id del cliente dueño del embed_key.
 * CONV-2: Registra la conversación y mensajes, y respeta el takeover humano (status='human').
 * EFIC-2: Consulta response_cache (cero tokens en cache hits) y registra consumo en token_usage.
 */
export async function POST(req: NextRequest) {
  let fallbackSessionId = `sess_${randomUUID()}`;

  try {
    const body = await req.json().catch(() => ({}));
    const { embed_key, message, session_id } = body;

    // 1. Validaciones básicas del payload
    if (!embed_key || typeof embed_key !== "string" || !embed_key.trim()) {
      return NextResponse.json(
        { error: "El campo embed_key es requerido" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "El mensaje es requerido" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (message.length > 2000) {
      return NextResponse.json(
        { error: "El mensaje no debe exceder 2000 caracteres" },
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanEmbedKey = embed_key.trim();
    const cleanMessage = message.trim();
    if (session_id && typeof session_id === "string" && session_id.trim()) {
      fallbackSessionId = session_id.trim();
    }

    // 2. Control de Rate Limit (max 30 msgs/min por embed_key + IP)
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "anon";
    const rateKey = `${cleanEmbedKey}:${clientIp}`;

    if (!checkRateLimit(rateKey)) {
      return NextResponse.json(
        {
          error: "Demasiadas solicitudes. Por favor espera un momento.",
          reply: "Has alcanzado el límite de mensajes por minuto. Por favor espera un momento.",
          session_id: fallbackSessionId,
        },
        { status: 429, headers: corsHeaders }
      );
    }

    const serviceClient = createServiceClient();

    // 3. Resolver embed_key → widget activo → client → workspace_id
    const { data: widget, error: widgetErr } = await (serviceClient.from("client_widgets") as any)
      .select(`
        id,
        client_id,
        embed_key,
        allowed_sources,
        theme,
        greeting,
        is_active,
        client:clients (
          id,
          display_name,
          workspace_id,
          status
        )
      `)
      .eq("embed_key", cleanEmbedKey)
      .eq("is_active", true)
      .maybeSingle();

    if (
      widgetErr ||
      !widget ||
      !widget.client ||
      !widget.client.workspace_id ||
      widget.client.status === "inactive"
    ) {
      return NextResponse.json(
        { error: "Widget no válido" },
        { status: 404, headers: corsHeaders }
      );
    }

    const clientId = widget.client_id;
    const workspaceId = widget.client.workspace_id;
    const businessName = widget.client.display_name || "la empresa";
    const allowedSources = Array.isArray(widget.allowed_sources) ? widget.allowed_sources : ["web"];

    // MEDIO 2026-10-28: allowed_sources ya no es solo decorativo. Las
    // entradas con forma de dominio son reglas de origen: si el widget
    // tiene al menos una, solo se aceptan peticiones cuyo Origin/Referer
    // coincida (exacto o *.dominio). Los tokens de canal ("web") no son
    // reglas y se ignoran. Sin reglas de dominio, el comportamiento es el
    // de antes (cualquier sitio puede embeberlo), porque la embed_key es
    // pública por diseño. El control real es este chequeo en servidor, no
    // la cabecera CORS: un POST de otro sitio igual llegaría, pero aquí
    // se rechaza antes de consumir tokens o crear conversación.
    const domainRules = (allowedSources as unknown[])
      .map((s: unknown) => String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0])
      .filter((s: string) => s && s !== "web" && s.includes("."));
    if (domainRules.length > 0) {
      const originHeader = req.headers.get("origin") || req.headers.get("referer") || "";
      let requestHost = "";
      try {
        requestHost = new URL(originHeader).hostname.toLowerCase();
      } catch {
        requestHost = "";
      }
      const originAllowed = domainRules.some(
        (rule: string) => requestHost === rule || (rule.startsWith("*.") && requestHost.endsWith(rule.slice(1)))
      );
      if (!originAllowed) {
        return NextResponse.json(
          { error: "Origen no permitido para este widget" },
          { status: 403 }
        );
      }
    }

    // NIV2-2: Corte de servicio si la suscripción del cliente está 'suspended' o 'cancelled'
    // (Cliente sin suscripción = servicio activo siempre; sin logs por mensaje bloqueado)
    const isServiceActive = await isClientServiceActive(clientId, serviceClient);
    if (!isServiceActive) {
      return NextResponse.json(
        {
          reply: "El servicio de chat no está disponible en este momento.",
          session_id: fallbackSessionId,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // 4. Buscar o crear la conversación (CONV-2)
    let conversation: any = null;
    const { data: existingConv } = await (serviceClient.from("conversations") as any)
      .select("id, status")
      .eq("client_id", clientId)
      .eq("channel", "widget")
      .eq("external_chat_id", fallbackSessionId)
      .maybeSingle();

    const nowIso = new Date().toISOString();

    if (existingConv) {
      conversation = existingConv;
    } else {
      const { data: newConv } = await (serviceClient.from("conversations") as any)
        .insert({
          client_id: clientId,
          channel: "widget",
          external_chat_id: fallbackSessionId,
          visitor_name: "Visitante Web",
          status: "bot",
          last_message_at: nowIso,
        })
        .select("id, status")
        .single();
      conversation = newConv;
    }

    // 5. Guardar el mensaje del visitante (role='visitor')
    if (conversation?.id) {
      await (serviceClient.from("conversation_messages") as any).insert({
        conversation_id: conversation.id,
        role: "visitor",
        content: cleanMessage,
        created_at: nowIso,
      });

      await (serviceClient.from("conversations") as any)
        .update({ last_message_at: nowIso, updated_at: nowIso })
        .eq("id", conversation.id);
    }

    // 6. Si la conversación está en takeover humano (status='human'), NO llamar al bot
    if (conversation?.status === "human") {
      return NextResponse.json(
        {
          reply: null,
          human_controlled: true,
          session_id: fallbackSessionId,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // 6.5 NIV3-1: Buscar en knowledge_entries activas del cliente por coincidencia de términos (ilike, top 5)
    let matchedKnowledge: Array<{ id: string; title: string | null; content: string; updated_at?: string }> = [];
    try {
      const stopwords = new Set([
        "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "en",
        "por", "para", "con", "sin", "sobre", "que", "qué", "cual", "cuál", "cuales",
        "cuáles", "como", "cómo", "donde", "dónde", "cuando", "cuándo", "quien", "quién",
        "es", "son", "esta", "está", "estan", "están", "hay", "tiene", "tienen", "hacer",
        "hacen", "puedo", "puede", "pueden", "hola", "buenos", "buenas", "dias", "días",
        "tardes", "noches", "gracias", "favor", "me", "te", "se", "nos", "mi", "tu", "su",
        "sus", "este", "esto", "ese", "esa", "eso", "y", "o", "u", "a", "ante", "bajo",
        "contra", "desde", "entre", "hacia", "hasta", "segun", "según", "tras", "algo",
      ]);

      const rawTokens = cleanMessage
        .toLowerCase()
        .replace(/[¿?¡!.,;:()"'«»[\]{}\\/|+*=<>~@#$^&%_,-]+/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

      let candidateTokens = rawTokens.filter((t) => t.length >= 3 && !stopwords.has(t));
      if (candidateTokens.length === 0) {
        candidateTokens = rawTokens.filter((t) => t.length >= 2);
      }

      const termSet = new Set<string>();
      for (const token of candidateTokens.slice(0, 8)) {
        termSet.add(token);
        const unaccented = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (unaccented.length >= 3) {
          termSet.add(unaccented);
        }
        if (token.endsWith("s") && token.length >= 4) {
          termSet.add(token.slice(0, -1));
          if (unaccented.length >= 4) {
            termSet.add(unaccented.slice(0, -1));
          }
        }
        // Comodín '_' en vocales para coincidencia insensible a tildes en PostgreSQL ILIKE
        const baseForWildcard = unaccented.endsWith("s") && unaccented.length >= 5
          ? unaccented.slice(0, -1)
          : unaccented;
        if (baseForWildcard.length >= 4) {
          const wildcarded = baseForWildcard.replace(/[aeiou]/g, "_");
          if (wildcarded.replace(/_/g, "").length >= 2) {
            termSet.add(wildcarded);
          }
        }
      }

      const terms = Array.from(termSet).slice(0, 12);
      if (terms.length > 0) {
        const orConditions = terms
          .map((t) => `title.ilike.%${t}%,content.ilike.%${t}%`)
          .join(",");

        const { data: kbRows } = await (serviceClient.from("knowledge_entries") as any)
          .select("id, title, content, updated_at")
          .eq("client_id", clientId)
          .eq("active", true)
          .or(orConditions)
          .limit(5);

        if (Array.isArray(kbRows) && kbRows.length > 0) {
          matchedKnowledge = kbRows;
        }
      }
    } catch {
      // Si falla o la tabla aún no existe, continuar sin interrumpir el chat
    }

    const cacheKeyInput =
      matchedKnowledge.length > 0
        ? `${cleanMessage}__kb:${matchedKnowledge.map((k) => `${k.id}:${k.updated_at || ""}`).join("|")}`
        : cleanMessage;

    // 7. EFIC-2: Verificar caché de respuestas ANTES de llamar al agente
    const cachedHit = await getCachedResponse(workspaceId, cacheKeyInput);
    if (cachedHit) {
      // Guardar respuesta del bot en la conversación para mantener el historial intacto
      if (conversation?.id) {
        const cacheReplyTime = new Date().toISOString();
        await (serviceClient.from("conversation_messages") as any).insert({
          conversation_id: conversation.id,
          role: "bot",
          content: cachedHit.response,
          created_at: cacheReplyTime,
        });

        await (serviceClient.from("conversations") as any)
          .update({ last_message_at: cacheReplyTime, updated_at: cacheReplyTime })
          .eq("id", conversation.id);
      }

      // Responder directamente sin invocar al agente (cero consumo de tokens)
      return NextResponse.json(
        {
          reply: cachedHit.response,
          cached: true,
          session_id: fallbackSessionId,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // 8. Conversación controlada por bot: Ejecutar agente de IA
    const { data: wsRecord } = await (serviceClient.from("workspaces") as any)
      .select("id, owner_id")
      .eq("id", workspaceId)
      .maybeSingle();

    const executionUserId = wsRecord?.owner_id || "00000000-0000-0000-0000-000000000000";

    const baseSystemPrompt = `Eres el asistente virtual oficial de "${businessName}".
Tu objetivo es responder de manera atenta, clara, profesional y concisa a los visitantes en su sitio web.
Fuentes e integraciones autorizadas para este canal: ${allowedSources.join(", ")}.
Responde en el mismo idioma del visitante (por defecto español). Nunca inventes información confidencial y mantén un tono cortés.`;

    const knowledgeSection =
      matchedKnowledge.length > 0
        ? `\n\nConocimiento del negocio:\n${matchedKnowledge
            .map((entry) =>
              entry.title && String(entry.title).trim()
                ? `- ${String(entry.title).trim()}: ${String(entry.content).trim()}`
                : `- ${String(entry.content).trim()}`
            )
            .join("\n")}`
        : "";

    const systemPrompt = `${baseSystemPrompt}${knowledgeSection}`;

    const modelName = "gemini-1.5-flash";

    try {
      const aiResponse = await defaultAIGateway.execute(
        {
          requestId: `req-widget-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          workspaceId,
          userId: executionUserId,
          conversationId: fallbackSessionId,
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: cleanMessage },
          ],
          options: {
            maxTokens: 1000,
          },
        },
        serviceClient
      );

      // Guardar respuesta del bot en la conversación
      if (conversation?.id) {
        const botReplyTime = new Date().toISOString();
        await (serviceClient.from("conversation_messages") as any).insert({
          conversation_id: conversation.id,
          role: "bot",
          content: aiResponse.content,
          created_at: botReplyTime,
        });

        await (serviceClient.from("conversations") as any)
          .update({ last_message_at: botReplyTime, updated_at: botReplyTime })
          .eq("id", conversation.id);
      }

      // EFIC-2: Guardar respuesta en caché y registrar consumo de tokens
      await setCachedResponse(workspaceId, cacheKeyInput, aiResponse.content, modelName);

      const inputTokens = aiResponse.usage?.inputTokens || Math.ceil(cleanMessage.length / 4);
      const outputTokens = aiResponse.usage?.outputTokens || Math.ceil(aiResponse.content.length / 4);

      await logTokenUsage({
        clientId,
        workspaceId,
        conversationId: conversation?.id,
        model: modelName,
        inputTokens,
        outputTokens,
      });

      return NextResponse.json(
        {
          reply: aiResponse.content,
          session_id: fallbackSessionId,
        },
        { status: 200, headers: corsHeaders }
      );
    } catch (agentErr: any) {
      // Si el agente falla → 200 con reply amable y error: true
      const politeError = `Hola, en este momento el asistente de ${businessName} está experimentando alta demanda. Por favor intenta de nuevo en unos instantes.`;

      if (conversation?.id) {
        const botErrorTime = new Date().toISOString();
        await (serviceClient.from("conversation_messages") as any).insert({
          conversation_id: conversation.id,
          role: "bot",
          content: politeError,
          created_at: botErrorTime,
        });
      }

      return NextResponse.json(
        {
          reply: politeError,
          session_id: fallbackSessionId,
          error: true,
        },
        { status: 200, headers: corsHeaders }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        reply: "No fue posible procesar tu mensaje en este momento. Por favor intenta más tarde.",
        session_id: fallbackSessionId,
        error: true,
      },
      { status: 200, headers: corsHeaders }
    );
  }
}
