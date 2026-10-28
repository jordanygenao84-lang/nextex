import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/tickets
 * Lista tickets de soporte con filtro opcional ?client_id= y ?status=
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores.
 */
export async function GET(req: NextRequest) {
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

    const clientId = req.nextUrl.searchParams.get("client_id")?.trim();
    const status = req.nextUrl.searchParams.get("status")?.trim();

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("support_tickets") as any)
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
      .order("updated_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    if (status && ["open", "in_progress", "closed"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data: tickets, error: dbErr } = await query;

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: dbErr.message } },
        { status: 500 }
      );
    }

    const list = tickets || [];
    return NextResponse.json({
      tickets: list,
      total: list.length,
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
