import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/invoices
 * Lista las facturas globales de clientes (con filtro opcional ?status=pending y ?client_id=...).
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

    const statusParam = req.nextUrl.searchParams.get("status")?.trim();
    const clientIdParam = req.nextUrl.searchParams.get("client_id")?.trim();

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("client_invoices") as any)
      .select(`
        id,
        client_id,
        subscription_id,
        kind,
        period,
        tokens_total,
        amount,
        currency,
        status,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("created_at", { ascending: false });

    if (statusParam) {
      query = query.eq("status", statusParam);
    }

    if (clientIdParam) {
      query = query.eq("client_id", clientIdParam);
    }

    const { data: invoices, error: dbErr } = await query;

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    const items = (invoices || []).map((inv: any) => ({
      ...inv,
      amount: Number(inv.amount),
      client_name: inv.client?.display_name || null,
    }));

    return NextResponse.json({
      invoices: items,
      total: items.length,
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
