import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserWorkspaces, isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/conversations
 * Bandeja global de conversaciones omnicanal (con auth y aislamiento por workspace).
 * Filtros opcionales: client_id, channel, status.
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("client_id");
    const channel = searchParams.get("channel");
    const status = searchParams.get("status");

    const serviceClient = createServiceClient();
    const superAdmin = await isSuperAdmin(user.id);

    let allowedClientIds: string[] | null = null;
    if (!superAdmin) {
      const allowedWorkspaces = await getUserWorkspaces(user.id);
      if (allowedWorkspaces.length === 0) {
        if (clientId) {
          return NextResponse.json(
            { error: { code: "NOT_FOUND", message: "Conversación o cliente no encontrado." } },
            { status: 404 }
          );
        }
        return NextResponse.json([]);
      }

      const { data: userClients } = await (serviceClient.from("clients") as any)
        .select("id")
        .in("workspace_id", allowedWorkspaces);

      allowedClientIds = Array.isArray(userClients)
        ? userClients.map((c: any) => c.id)
        : [];

      if (clientId && !allowedClientIds.includes(clientId)) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Conversación o cliente no encontrado." } },
          { status: 404 }
        );
      }

      if (allowedClientIds.length === 0) {
        return NextResponse.json([]);
      }
    }

    let query = (serviceClient.from("conversations") as any)
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
      .order("last_message_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    } else if (allowedClientIds !== null) {
      query = query.in("client_id", allowedClientIds);
    }

    if (channel) {
      query = query.eq("channel", channel);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data: conversations, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (!conversations || conversations.length === 0) {
      return NextResponse.json([]);
    }

    // Calcular unread_count para cada conversación:
    // Contar mensajes role=visitor creados después del último mensaje role=human_agent (si no hay, todos los visitor)
    const conversationIds = conversations.map((c: any) => c.id);

    const { data: messages } = await (serviceClient.from("conversation_messages") as any)
      .select("id, conversation_id, role, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });

    const messagesByConv: Record<string, any[]> = {};
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!messagesByConv[msg.conversation_id]) {
          messagesByConv[msg.conversation_id] = [];
        }
        messagesByConv[msg.conversation_id].push(msg);
      }
    }

    const result = conversations.map((conv: any) => {
      const convMsgs = messagesByConv[conv.id] || [];

      // Buscar fecha del último mensaje enviado por un agente humano
      let lastHumanAgentTime: string | null = null;
      for (let i = convMsgs.length - 1; i >= 0; i--) {
        if (convMsgs[i].role === "human_agent") {
          lastHumanAgentTime = convMsgs[i].created_at;
          break;
        }
      }

      // Contar visitantes posteriores a esa fecha (o todos si nunca respondió humano)
      let unreadCount = 0;
      for (const msg of convMsgs) {
        if (msg.role === "visitor") {
          if (!lastHumanAgentTime || new Date(msg.created_at) > new Date(lastHumanAgentTime)) {
            unreadCount++;
          }
        }
      }

      return {
        id: conv.id,
        client_id: conv.client_id,
        client_name: conv.client?.display_name || "Cliente",
        channel: conv.channel,
        external_chat_id: conv.external_chat_id,
        visitor_name: conv.visitor_name,
        status: conv.status,
        last_message_at: conv.last_message_at,
        unread_count: unreadCount,
      };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
