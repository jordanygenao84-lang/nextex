import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveClientFromSiteKey } from "@/lib/vigia/site-auth";

export const dynamic = "force-dynamic";

const ALLOWED_PRIORITIES = new Set(["low", "normal", "high"]);

/**
 * POST /api/support/report
 * Endpoint de intake para creación de tickets de soporte desde webs satélite (NIV3-3).
 *
 * Autenticación:
 *   Header `Authorization: Bearer <clave de sitio ntx_...>`
 *   Sin llave válida → 401.
 *
 * Body JSON:
 *   { subject: string, message: string, priority?: 'low'|'normal'|'high' }
 *
 * Comportamiento:
 *   Crea ticket en support_tickets con status='open' y primer mensaje en ticket_messages con author='client'.
 *   Responde 201 con el id del ticket.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");

    const clientId = await resolveClientFromSiteKey(authHeader);
    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Clave de sitio inválida o ausente.",
          },
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Se requiere un cuerpo JSON válido.",
          },
        },
        { status: 400 }
      );
    }

    const subject =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!subject) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'subject' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'message' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    let priority = "normal";
    if (body.priority !== undefined && body.priority !== null && String(body.priority).trim() !== "") {
      const cleanPriority = String(body.priority).trim().toLowerCase();
      if (!ALLOWED_PRIORITIES.has(cleanPriority)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'priority' debe ser 'low', 'normal' o 'high'.",
            },
          },
          { status: 400 }
        );
      }
      priority = cleanPriority;
    }

    const serviceClient = createServiceClient();
    const nowIso = new Date().toISOString();

    const { data: ticket, error: ticketErr } = await (
      serviceClient.from("support_tickets") as any
    )
      .insert({
        client_id: clientId,
        subject,
        status: "open",
        priority,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, client_id, subject, status, priority, created_at, updated_at")
      .single();

    if (ticketErr || !ticket) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: ticketErr?.message || "No se pudo crear el ticket de soporte.",
          },
        },
        { status: 500 }
      );
    }

    const { error: msgErr } = await (
      serviceClient.from("ticket_messages") as any
    ).insert({
      ticket_id: ticket.id,
      author: "client",
      body: message,
      created_at: nowIso,
    });

    if (msgErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: msgErr.message || "Error al guardar el mensaje inicial del ticket.",
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        id: ticket.id,
        ticket_id: ticket.id,
        status: ticket.status,
        priority: ticket.priority,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error interno al reportar ticket de soporte.",
        },
      },
      { status: 500 }
    );
  }
}
