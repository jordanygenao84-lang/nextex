import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "closed"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high"]);

async function requireSuperAdmin() {
  const userClient = createClient();
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      ),
    };
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, user };
}

/**
 * GET /api/admin/tickets/[id]
 * Obtiene un ticket de soporte y su hilo completo de mensajes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

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

    const serviceClient = createServiceClient();

    const { data: ticket, error: ticketErr } = await (
      serviceClient.from("support_tickets") as any
    )
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
      .eq("id", ticketId)
      .maybeSingle();

    if (ticketErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: ticketErr.message } },
        { status: 500 }
      );
    }

    if (!ticket) {
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

    const { data: messages, error: msgErr } = await (
      serviceClient.from("ticket_messages") as any
    )
      .select("id, ticket_id, author, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (msgErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: msgErr.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ticket,
      messages: messages || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/tickets/[id]
 * Borrado permanente de un ticket y su hilo de mensajes.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

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

    const serviceClient = createServiceClient();

    const { error: msgErr } = await (serviceClient.from("ticket_messages") as any)
      .delete()
      .eq("ticket_id", ticketId);
    if (msgErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: msgErr.message } },
        { status: 500 }
      );
    }

    const { data: deleted, error: delErr } = await (serviceClient.from("support_tickets") as any)
      .delete()
      .eq("id", ticketId)
      .select("id")
      .maybeSingle();
    if (delErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: delErr.message } },
        { status: 500 }
      );
    }
    if (!deleted) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Ticket de soporte no encontrado." } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Ticket eliminado exitosamente." });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/tickets/[id]
 * Actualiza status y/o priority de un ticket de soporte.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

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

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status !== undefined) {
      const cleanStatus = String(body.status).trim();
      if (!ALLOWED_STATUSES.has(cleanStatus)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El estado debe ser 'open', 'in_progress' o 'closed'.",
            },
          },
          { status: 400 }
        );
      }
      updates.status = cleanStatus;
    }

    if (body.priority !== undefined) {
      const cleanPriority = String(body.priority).trim();
      if (!ALLOWED_PRIORITIES.has(cleanPriority)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "La prioridad debe ser 'low', 'normal' o 'high'.",
            },
          },
          { status: 400 }
        );
      }
      updates.priority = cleanPriority;
    }

    const serviceClient = createServiceClient();
    const { data: updated, error: updateErr } = await (
      serviceClient.from("support_tickets") as any
    )
      .update(updates)
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

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updated) {
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

    return NextResponse.json({ ticket: updated });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
