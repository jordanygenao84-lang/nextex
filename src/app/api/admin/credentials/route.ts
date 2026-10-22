import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import {
  calculateDaysLeft,
  computeCredentialStatus,
} from "@/lib/protection/credentials";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = [
  "github",
  "vercel",
  "supabase",
  "meta",
  "google",
  "openai",
  "otro",
] as const;

/**
 * GET /api/admin/credentials
 * Lista el inventario de credenciales ordenado por expires_at ASC (sin fecha al final).
 * Cada credencial incluye days_left calculado y status ('expired', 'warning', 'ok', 'no_expiry').
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
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: credentials, error: dbErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .select(`
        id,
        client_id,
        name,
        provider,
        location,
        expires_at,
        alert_days_before,
        notes,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("expires_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: dbErr.message } },
        { status: 500 }
      );
    }

    const items = (credentials || []).map((cred: any) => {
      const days_left = calculateDaysLeft(cred.expires_at);
      const status = computeCredentialStatus(days_left, cred.alert_days_before);
      return {
        ...cred,
        days_left,
        status,
      };
    });

    // Garantizar que los que no tienen fecha queden siempre al final
    items.sort((a: any, b: any) => {
      if (!a.expires_at && !b.expires_at) return 0;
      if (!a.expires_at) return 1;
      if (!b.expires_at) return -1;
      return a.expires_at.localeCompare(b.expires_at);
    });

    return NextResponse.json({
      credentials: items,
      total: items.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al obtener inventario de credenciales.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/credentials
 * Crea una nueva credencial en la bóveda de inventario.
 * name y provider son obligatorios.
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
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      name,
      provider,
      client_id,
      location,
      expires_at,
      alert_days_before,
      notes,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "El campo 'name' es obligatorio." } },
        { status: 400 }
      );
    }

    if (!provider || typeof provider !== "string" || !VALID_PROVIDERS.includes(provider.trim().toLowerCase() as any)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `El campo 'provider' es obligatorio y debe ser uno de: ${VALID_PROVIDERS.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const alertDays =
      alert_days_before != null && !isNaN(Number(alert_days_before))
        ? Math.max(0, parseInt(String(alert_days_before), 10))
        : 7;

    let parsedExpiresAt: string | null = null;
    if (expires_at) {
      const trimmed = String(expires_at).trim();
      // Validar formato YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        parsedExpiresAt = trimmed;
      } else {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'expires_at' debe tener el formato YYYY-MM-DD.",
            },
          },
          { status: 400 }
        );
      }
    }

    const serviceClient = createServiceClient();
    const insertPayload: any = {
      name: name.trim(),
      provider: provider.trim().toLowerCase(),
      client_id: client_id || null,
      location: location && typeof location === "string" ? location.trim() : null,
      expires_at: parsedExpiresAt,
      alert_days_before: alertDays,
      notes: notes && typeof notes === "string" ? notes.trim() : null,
    };

    const { data: created, error: insertErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .insert(insertPayload)
      .select(`
        id,
        client_id,
        name,
        provider,
        location,
        expires_at,
        alert_days_before,
        notes,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .single();

    if (insertErr || !created) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al registrar credencial." } },
        { status: 500 }
      );
    }

    const days_left = calculateDaysLeft(created.expires_at);
    const status = computeCredentialStatus(days_left, created.alert_days_before);

    return NextResponse.json(
      {
        credential: {
          ...created,
          days_left,
          status,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al registrar credencial.",
        },
      },
      { status: 500 }
    );
  }
}
