import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { getTodayUtcDateString } from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";

const VALID_CURRENCIES = ["USD", "DOP"] as const;
const VALID_STATUSES = [
  "active",
  "past_due",
  "suspended",
  "cancelled",
] as const;

/**
 * GET /api/admin/subscriptions
 * Lista todas las suscripciones con nombre del cliente, estado, próximo cobro
 * y conteo de facturas pendientes.
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

    const serviceClient = createServiceClient();

    const [
      { data: subscriptions, error: subErr },
      { data: pendingInvoices, error: invErr },
    ] = await Promise.all([
      (serviceClient.from("client_subscriptions") as any)
        .select(`
          id,
          client_id,
          plan_name,
          amount,
          currency,
          billing_day,
          status,
          grace_days,
          next_invoice_date,
          created_at,
          updated_at,
          client:clients (
            id,
            display_name
          )
        `)
        .order("next_invoice_date", { ascending: true }),
      (serviceClient.from("client_invoices") as any)
        .select("id, client_id, subscription_id, kind, period, amount, currency, status, created_at")
        .eq("status", "pending"),
    ]);

    if (subErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (invErr) {
      console.warn(
        "[ADMIN SUBSCRIPTIONS] Error consultando facturas pendientes:",
        invErr
      );
    }

    const pendingList = Array.isArray(pendingInvoices) ? pendingInvoices : [];

    const items = (subscriptions || []).map((sub: any) => {
      const clientPending = pendingList.filter(
        (inv: any) => inv.client_id === sub.client_id
      );
      const subscriptionPending = clientPending.filter(
        (inv: any) => inv.kind === "subscription"
      );

      return {
        ...sub,
        amount: Number(sub.amount),
        client_name: sub.client?.display_name || null,
        pending_invoices_count: clientPending.length,
        pending_subscription_invoices_count: subscriptionPending.length,
        pending_invoices: clientPending,
      };
    });

    return NextResponse.json({
      subscriptions: items,
      total: items.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR", message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/subscriptions
 * Crea una nueva suscripción para un cliente.
 * Campos obligatorios: client_id, plan_name, amount.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}));
    const {
      client_id,
      plan_name,
      amount,
      currency,
      billing_day,
      status,
      grace_days,
      next_invoice_date,
    } = body;

    if (!client_id || typeof client_id !== "string" || !client_id.trim()) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'client_id' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    if (!plan_name || typeof plan_name !== "string" || !plan_name.trim()) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'plan_name' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const parsedAmount = Number(amount);
    if (amount === undefined || amount === null || isNaN(parsedAmount) || parsedAmount < 0) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'amount' es obligatorio y debe ser un número válido >= 0.",
          },
        },
        { status: 400 }
      );
    }

    const parsedCurrency = currency
      ? String(currency).trim().toUpperCase()
      : "USD";
    if (!VALID_CURRENCIES.includes(parsedCurrency as any)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `El campo 'currency' debe ser uno de: ${VALID_CURRENCIES.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const parsedStatus = status ? String(status).trim().toLowerCase() : "active";
    if (!VALID_STATUSES.includes(parsedStatus as any)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `El campo 'status' debe ser uno de: ${VALID_STATUSES.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    let parsedNextInvoiceDate = getTodayUtcDateString();
    if (next_invoice_date !== undefined && next_invoice_date !== null && String(next_invoice_date).trim() !== "") {
      const trimmedDate = String(next_invoice_date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'next_invoice_date' debe tener formato YYYY-MM-DD.",
            },
          },
          { status: 400 }
        );
      }
      parsedNextInvoiceDate = trimmedDate;
    }

    let parsedBillingDay: number | null = null;
    if (billing_day !== undefined && billing_day !== null && billing_day !== "") {
      const bd = Number(billing_day);
      if (!Number.isInteger(bd) || bd < 1 || bd > 28) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'billing_day' debe ser un entero entre 1 y 28.",
            },
          },
          { status: 400 }
        );
      }
      parsedBillingDay = bd;
    } else {
      const dayFromInvoiceDate = Number(parsedNextInvoiceDate.split("-")[2]);
      parsedBillingDay = Math.min(Math.max(1, dayFromInvoiceDate || 1), 28);
    }

    const parsedGraceDays =
      grace_days !== undefined && grace_days !== null && !isNaN(Number(grace_days))
        ? Math.max(0, parseInt(String(grace_days), 10))
        : 3;

    const serviceClient = createServiceClient();

    const { data: created, error: insertErr } = await (
      serviceClient.from("client_subscriptions") as any
    )
      .insert({
        client_id: client_id.trim(),
        plan_name: plan_name.trim(),
        amount: parsedAmount,
        currency: parsedCurrency,
        billing_day: parsedBillingDay,
        status: parsedStatus,
        grace_days: parsedGraceDays,
        next_invoice_date: parsedNextInvoiceDate,
      })
      .select(`
        id,
        client_id,
        plan_name,
        amount,
        currency,
        billing_day,
        status,
        grace_days,
        next_invoice_date,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .single();

    if (insertErr) {
      const isConflict =
        insertErr.code === "23505" ||
        String(insertErr.message || "").toLowerCase().includes("duplicate");
      return NextResponse.json(
        {
          error: {
            code: isConflict ? "CONFLICT" : "DB_ERROR",
            message: isConflict
              ? "Este cliente ya posee una suscripción registrada."
              : insertErr.message,
          },
        },
        { status: isConflict ? 409 : 500 }
      );
    }

    return NextResponse.json(
      {
        subscription: {
          ...created,
          amount: Number(created.amount),
          client_name: created.client?.display_name || null,
        },
      },
      { status: 201 }
    );
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
