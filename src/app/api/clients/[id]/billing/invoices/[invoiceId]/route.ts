import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const VALID_INVOICE_STATUSES = ["paid", "cancelled"] as const;

/**
 * PATCH /api/clients/[id]/billing/invoices/[invoiceId]
 * Actualiza el estado de una factura ('paid' | 'cancelled') (con auth).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; invoiceId: string } }
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

    const { id: clientId, invoiceId } = params;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // 2. Validar payload
    const body = await req.json().catch(() => ({}));
    const { status } = body;

    if (!status || !VALID_INVOICE_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PARAMETERS",
            message: `El estado debe ser uno de: ${VALID_INVOICE_STATUSES.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Actualizar la factura
    const { data: updatedInvoice, error: updateErr } = await (serviceClient.from("client_invoices") as any)
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId)
      .eq("client_id", clientId)
      .select("id, client_id, subscription_id, kind, period, tokens_total, amount, currency, status, created_at, updated_at")
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updatedInvoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Factura no encontrada para este cliente." } },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedInvoice, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
