import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/conversations/[id]/takeover
 * Cambia el estado de la conversación a 'human' (toma de control humano).
 * El bot se silencia en este chat.
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
    const serviceClient = createServiceClient();

    const { data: updated, error } = await (serviceClient.from("conversations") as any)
      .update({
        status: "human",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .select(`
        id,
        client_id,
        channel,
        external_chat_id,
        visitor_name,
        status,
        last_message_at,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversación no encontrada." } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: updated.id,
      client_id: updated.client_id,
      client_name: updated.client?.display_name || "Cliente",
      channel: updated.channel,
      external_chat_id: updated.external_chat_id,
      visitor_name: updated.visitor_name,
      status: updated.status,
      last_message_at: updated.last_message_at,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al tomar control de la conversación." } },
      { status: 500 }
    );
  }
}
