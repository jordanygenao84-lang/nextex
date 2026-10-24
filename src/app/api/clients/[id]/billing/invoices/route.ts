import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { calculateClientBilling } from "@/lib/billing/client-billing";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/billing/invoices
 * Lista el historial de facturas generadas para el cliente ordenadas por período descendente (con auth).
 */
export async function GET(
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

    const clientId = params.id;
    const serviceClient = createServiceClient();

    // 1. Verificar existencia del cliente
    const { data: client, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    // 2. Consultar facturas ordenadas por período desc
    const { data: invoices, error: invErr } = await (serviceClient.from("client_invoices") as any)
      .select("id, client_id, subscription_id, kind, period, tokens_total, amount, currency, status, created_at, updated_at")
      .eq("client_id", clientId)
      .order("period", { ascending: false });

    if (invErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: invErr.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(invoices || []);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar facturas del cliente." } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[id]/billing/invoices
 * Genera la factura del mes actual para el cliente (con auth).
 * Si ya existe factura para el período actual -> 409 Conflict.
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

    const clientId = params.id;
    const serviceClient = createServiceClient();

    // 1. Verificar existencia del cliente
    const { data: client, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    // 2. Definir período actual (YYYY-MM)
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = String(now.getMonth() + 1).padStart(2, "0");
    const periodStr = `${year}-${monthNum}`;
    const startOfMonthIso = new Date(year, now.getMonth(), 1).toISOString();

    // 3. Verificar si ya existe una factura de consumo para este cliente y período
    const { data: existingInvoice } = await (serviceClient.from("client_invoices") as any)
      .select("id")
      .eq("client_id", clientId)
      .eq("period", periodStr)
      .eq("kind", "consumption")
      .maybeSingle();

    if (existingInvoice) {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: `Ya existe una factura para el período ${periodStr}`,
          },
        },
        { status: 409 }
      );
    }

    // 4. Calcular el monto y total de tokens consumidos
    const billingSummary = await calculateClientBilling(
      serviceClient,
      clientId,
      periodStr,
      startOfMonthIso
    );

    // 5. Crear la factura en client_invoices con status 'pending' y kind 'consumption'
    const { data: newInvoice, error: insertErr } = await (serviceClient.from("client_invoices") as any)
      .insert({
        client_id: clientId,
        kind: "consumption",
        period: periodStr,
        tokens_total: billingSummary.tokens_total,
        amount: billingSummary.amount_estimate,
        currency: "USD",
        status: "pending",
      })
      .select("id, client_id, subscription_id, kind, period, tokens_total, amount, currency, status, created_at, updated_at")
      .single();

    if (insertErr || !newInvoice) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al crear la factura." } },
        { status: 500 }
      );
    }

    return NextResponse.json(newInvoice, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al generar factura." } },
      { status: 500 }
    );
  }
}
