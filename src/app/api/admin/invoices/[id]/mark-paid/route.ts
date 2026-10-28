import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/invoices/[id]/mark-paid
 * Marca una factura como 'paid' (equivalente directo para super_admin sin requerir client_id en la ruta,
 * complementando la vía por cliente PATCH /api/clients/[id]/billing/invoices/[invoiceId]).
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
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

    const invoiceId = params.id;
    if (!invoiceId) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PARAMETERS",
            message: "ID de factura requerido.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    const { data: updatedInvoice, error: updateErr } = await (
      serviceClient.from("client_invoices") as any
    )
      .update({
        status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId)
      .select(
        "id, client_id, subscription_id, kind, period, tokens_total, amount, currency, status, created_at, updated_at"
      )
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updatedInvoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Factura no encontrada." } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      invoice: updatedInvoice,
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
