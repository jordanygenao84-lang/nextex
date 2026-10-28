import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedConversation } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/conversations/[id]
 * Detalle de la conversación con su historial de mensajes ordenados cronológicamente (con auth).
 */
export async function GET(
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
    const conv = await resolveAuthorizedConversation(user.id, conversationId);

    if (!conv) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversación no encontrada." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // 2. Obtener mensajes ordenados ascendentemente
    const { data: messages, error: msgErr } = await (serviceClient.from("conversation_messages") as any)
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation: {
        id: conv.id,
        client_id: conv.client_id,
        client_name: conv.client?.display_name || "Cliente",
        channel: conv.channel,
        external_chat_id: conv.external_chat_id,
        visitor_name: conv.visitor_name,
        status: conv.status,
        last_message_at: conv.last_message_at,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      },
      messages: messages || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
