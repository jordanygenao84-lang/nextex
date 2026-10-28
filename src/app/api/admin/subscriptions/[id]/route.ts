import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const VALID_CURRENCIES = ["USD", "DOP"] as const;
const VALID_STATUSES = [
  "active",
  "past_due",
  "suspended",
  "cancelled",
] as const;

/**
 * PATCH /api/admin/subscriptions/[id]
 * Edita los campos y el estado de una suscripción (incluyendo cancelar).
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function PATCH(
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

    const subscriptionId = params.id;
    if (!subscriptionId) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PARAMETERS",
            message: "ID de suscripción requerido.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: existing, error: findErr } = await (
      serviceClient.from("client_subscriptions") as any
    )
      .select("id")
      .eq("id", subscriptionId)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Suscripción no encontrada.",
          },
        },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.plan_name !== undefined) {
      if (typeof body.plan_name !== "string" || !body.plan_name.trim()) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'plan_name' no puede estar vacío.",
            },
          },
          { status: 400 }
        );
      }
      updates.plan_name = body.plan_name.trim();
    }

    if (body.amount !== undefined) {
      const parsedAmount = Number(body.amount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'amount' debe ser un número válido >= 0.",
            },
          },
          { status: 400 }
        );
      }
      updates.amount = parsedAmount;
    }

    if (body.currency !== undefined) {
      const c = String(body.currency).trim().toUpperCase();
      if (!VALID_CURRENCIES.includes(c as any)) {
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
      updates.currency = c;
    }

    if (body.billing_day !== undefined) {
      if (body.billing_day === null || body.billing_day === "") {
        updates.billing_day = null;
      } else {
        const bd = Number(body.billing_day);
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
        updates.billing_day = bd;
      }
    }

    if (body.status !== undefined) {
      const s = String(body.status).trim().toLowerCase();
      if (!VALID_STATUSES.includes(s as any)) {
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
      updates.status = s;
    }

    if (body.grace_days !== undefined) {
      const gd = Number(body.grace_days);
      if (isNaN(gd) || gd < 0) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'grace_days' debe ser un entero >= 0.",
            },
          },
          { status: 400 }
        );
      }
      updates.grace_days = Math.floor(gd);
    }

    if (body.next_invoice_date !== undefined) {
      const trimmedDate = String(body.next_invoice_date).trim();
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
      updates.next_invoice_date = trimmedDate;
    }

    const { data: updated, error: updateErr } = await (
      serviceClient.from("client_subscriptions") as any
    )
      .update(updates)
      .eq("id", subscriptionId)
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

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: updateErr?.message || "Error al actualizar suscripción.",
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      subscription: {
        ...updated,
        amount: Number(updated.amount),
        client_name: updated.client?.display_name || null,
      },
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
