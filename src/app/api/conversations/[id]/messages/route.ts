import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/conversations/[id]/messages
 * Permite a un agente humano responder dentro de la conversación.
 * REGLA: Solo se permite el envío si status = 'human'. Si está en 'bot' -> 409 { error: 'Toma el control primero' }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const conversationId = params.id;
    const body = await req.json().catch(() => ({}));
    const { content } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El mensaje es requerido." } },
        { status: 400 }
      );
    }

    if (content.length > 2000) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El mensaje no debe exceder 2000 caracteres." } },
        { status: 400 }
      );
    }

    const cleanContent = content.trim();
    const serviceClient = createServiceClient();

    // 1. Verificar estado actual de la conversación
    const { data: conv, error: convErr } = await (serviceClient.from("conversations") as any)
      .select("id, status")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversación no encontrada." } },
        { status: 404 }
      );
    }

    // Si está en 'bot' -> 409 { error: 'Toma el control primero' }
    if (conv.status !== "human") {
      return NextResponse.json(
        { error: "Toma el control primero" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // 2. Insertar mensaje con role = 'human_agent'
    const { data: newMsg, error: insertErr } = await (serviceClient.from("conversation_messages") as any)
      .insert({
        conversation_id: conversationId,
        role: "human_agent",
        content: cleanContent,
        created_at: now,
      })
      .select("id, conversation_id, role, content, created_at")
      .single();

    if (insertErr || !newMsg) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al guardar mensaje." } },
        { status: 500 }
      );
    }

    // 3. Actualizar last_message_at de la conversación
    await (serviceClient.from("conversations") as any)
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq("id", conversationId);

    return NextResponse.json(newMsg, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al enviar mensaje del asesor." } },
      { status: 500 }
    );
  }
}
