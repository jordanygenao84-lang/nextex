import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/tickets/[id]/reply
 * Registra una respuesta de administrador (author='admin') en el ticket.
 * Si el ticket estaba en estado 'open', pasa automáticamente a 'in_progress'.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      );
    }

    const ticketId = params.id?.trim();
    if (!ticketId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "ID de ticket requerido.",
          },
        },
        { status: 400 }
      );
    }

    const payload = await req.json().catch(() => ({}));
    const rawBody =
      typeof payload.body === "string"
        ? payload.body
        : typeof payload.message === "string"
        ? payload.message
        : "";
    const cleanBody = rawBody.trim();

    if (!cleanBody) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El cuerpo del mensaje ('body') es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    const { data: existingTicket, error: ticketErr } = await (
      serviceClient.from("support_tickets") as any
    )
      .select("id, status")
      .eq("id", ticketId)
      .maybeSingle();

    if (ticketErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: ticketErr.message } },
        { status: 500 }
      );
    }

    if (!existingTicket) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Ticket de soporte no encontrado.",
          },
        },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: createdMessage, error: msgErr } = await (
      serviceClient.from("ticket_messages") as any
    )
      .insert({
        ticket_id: ticketId,
        author: "admin",
        body: cleanBody,
        created_at: nowIso,
      })
      .select("id, ticket_id, author, body, created_at")
      .single();

    if (msgErr || !createdMessage) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: msgErr?.message || "No se pudo registrar la respuesta.",
          },
        },
        { status: 500 }
      );
    }

    const nextStatus =
      existingTicket.status === "open" ? "in_progress" : existingTicket.status;

    const { data: updatedTicket } = await (
      serviceClient.from("support_tickets") as any
    )
      .update({
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq("id", ticketId)
      .select(`
        id,
        client_id,
        subject,
        status,
        priority,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .maybeSingle();

    return NextResponse.json(
      {
        message: createdMessage,
        ticket: updatedTicket || { ...existingTicket, status: nextStatus },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al responder ticket de soporte.",
        },
      },
      { status: 500 }
    );
  }
}
