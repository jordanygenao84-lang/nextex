import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/widget/config?key=<embed_key>
 * Endpoint público para que el widget web cargue su configuración visual y fuentes autorizadas.
 * NUNCA expone client_id, workspace_id ni credenciales.
 */
export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");

    if (!key || typeof key !== "string" || !key.trim()) {
      return NextResponse.json(
        { error: "Widget no válido" },
        { status: 404, headers: corsHeaders }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Buscar widget por embed_key activo
    const { data: widget, error } = await (serviceClient.from("client_widgets") as any)
      .select(`
        id,
        embed_key,
        greeting,
        theme,
        allowed_sources,
        is_active,
        client:clients (
          id,
          display_name,
          status
        )
      `)
      .eq("embed_key", key.trim())
      .eq("is_active", true)
      .maybeSingle();

    if (error || !widget || !widget.client || widget.client.status === "inactive") {
      return NextResponse.json(
        { error: "Widget no válido" },
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Responder estrictamente con la información pública del widget
    return NextResponse.json(
      {
        greeting: widget.greeting || "¡Hola! ¿En qué podemos ayudarte hoy?",
        theme: widget.theme || {},
        allowed_sources: widget.allowed_sources || [],
        business_name: widget.client?.display_name || "Asistente Virtual",
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Widget no válido" },
      { status: 404, headers: corsHeaders }
    );
  }
}
