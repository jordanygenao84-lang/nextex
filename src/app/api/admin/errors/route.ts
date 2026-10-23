import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/errors
 * Lista el registro central de errores agrupados (NIV1-4).
 *
 * Parámetros opcionales (query):
 *   - client_id: filtra por cliente específico
 *
 * Retorna:
 *   - errors: lista ordenada por last_seen_at desc con datos de cliente
 *   - summary: { total_groups, occurrences_24h }
 *
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
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

    const clientIdParam = req.nextUrl.searchParams.get("client_id")?.trim();

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("error_events") as any)
      .select(`
        id,
        client_id,
        fingerprint,
        error_type,
        message,
        detail,
        occurrences,
        first_seen_at,
        last_seen_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("last_seen_at", { ascending: false });

    if (clientIdParam) {
      query = query.eq("client_id", clientIdParam);
    }

    const { data: errors, error: dbErr } = await query;

    if (dbErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: dbErr.message || "Error al obtener registro de errores.",
          },
        },
        { status: 500 }
      );
    }

    const list = Array.isArray(errors) ? errors : [];

    // Calcular resumen: total de grupos y ocurrencias en las últimas 24h
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const occurrences24h = list.reduce((acc: number, item: any) => {
      if (item.last_seen_at) {
        const itemTime = new Date(item.last_seen_at).getTime();
        if (itemTime >= cutoff24h) {
          return acc + (Number(item.occurrences) || 1);
        }
      }
      return acc;
    }, 0);

    return NextResponse.json({
      errors: list,
      summary: {
        total_groups: list.length,
        occurrences_24h: occurrences24h,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            err?.message || "Error al procesar solicitud de errores de webs.",
        },
      },
      { status: 500 }
    );
  }
}
