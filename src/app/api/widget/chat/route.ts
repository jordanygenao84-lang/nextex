import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";

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

    const workspaceId = widget.client.workspace_id;
    const businessName = widget.client.display_name || "la empresa";
    const allowedSources = Array.isArray(widget.allowed_sources) ? widget.allowed_sources : ["web"];

    // 4. Obtener owner_id del workspace para autorización en AI Gateway
    const { data: wsRecord } = await (serviceClient.from("workspaces") as any)
      .select("id, owner_id")
      .eq("id", workspaceId)
      .maybeSingle();

    const executionUserId = wsRecord?.owner_id || "00000000-0000-0000-0000-000000000000";

    const systemPrompt = `Eres el asistente virtual oficial de "${businessName}".
Tu objetivo es responder de manera atenta, clara, profesional y concisa a los visitantes en su sitio web.
Fuentes e integraciones autorizadas para este canal: ${allowedSources.join(", ")}.
Responde en el mismo idioma del visitante (por defecto español). Nunca inventes información confidencial y mantén un tono cortés.`;

    // 5. Ejecución del agente con el workspace_id estricto del cliente dueño
    try {
      const aiResponse = await defaultAIGateway.execute(
        {
          requestId: `req-widget-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          workspaceId,
          userId: executionUserId,
          conversationId: fallbackSessionId,
          model: "gemini-1.5-flash",
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

      return NextResponse.json(
        {
          reply: aiResponse.content,
          session_id: fallbackSessionId,
        },
        { status: 200, headers: corsHeaders }
      );
    } catch (agentErr: any) {
      // Regla de resiliencia: Si el agente falla → 200 con reply amable y error: true
      return NextResponse.json(
        {
          reply: `Hola, en este momento el asistente de ${businessName} está experimentando alta demanda. Por favor intenta de nuevo en unos instantes.`,
          session_id: fallbackSessionId,
          error: true,
        },
        { status: 200, headers: corsHeaders }
      );
    }
  } catch (err: any) {
    // Si ocurre un error inesperado al parsear, responder amablemente con status 200 para no romper el widget
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
