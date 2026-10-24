import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import {
  normalizeDomainName,
  computeExpirationOverrideStatus,
  checkDomainExpirations,
} from "@/lib/domains/check";
import { calculateDaysLeft } from "@/lib/protection/credentials";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/domains
 * Lista todos los dominios con su estado DNS, vencimiento y última revisión.
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
    const { data: domains, error: dbErr } = await (
      serviceClient.from("domains") as any
    )
      .select(`
        id,
        client_id,
        domain,
        provider,
        registrar,
        expires_at,
        auto_renew,
        expected_target,
        dns_status,
        dns_checked_at,
        notes,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("created_at", { ascending: false });

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: dbErr.message } },
        { status: 500 }
      );
    }

    const items = (domains || []).map((dom: any) => {
      const days_left = calculateDaysLeft(dom.expires_at);
      const expStatus = computeExpirationOverrideStatus(dom.expires_at);
      const effectiveStatus = expStatus || dom.dns_status || "unknown";

      return {
        ...dom,
        dns_status: effectiveStatus,
        days_left,
      };
    });

    return NextResponse.json({
      domains: items,
      total: items.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al listar inventario de dominios.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/domains
 * Registra un nuevo dominio en el inventario (domain obligatorio, resto opcional).
 * Si expires_at <= hoy + 30 días, asigna estado 'expiring'/'expired' y evalúa la alerta.
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
      domain,
      client_id,
      provider,
      registrar,
      expires_at,
      auto_renew,
      expected_target,
      notes,
    } = body;

    if (!domain || typeof domain !== "string" || !normalizeDomainName(domain)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'domain' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const cleanDomain = normalizeDomainName(domain);

    let parsedExpiresAt: string | null = null;
    if (
      expires_at !== undefined &&
      expires_at !== null &&
      String(expires_at).trim() !== ""
    ) {
      const trimmedDate = String(expires_at).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'expires_at' debe tener formato YYYY-MM-DD.",
            },
          },
          { status: 400 }
        );
      }
      parsedExpiresAt = trimmedDate;
    }

    const expOverride = computeExpirationOverrideStatus(parsedExpiresAt);
    const initialStatus = expOverride || "unknown";

    const serviceClient = createServiceClient();

    const { data: created, error: insertErr } = await (
      serviceClient.from("domains") as any
    )
      .insert({
        domain: cleanDomain,
        client_id: client_id && String(client_id).trim() ? String(client_id).trim() : null,
        provider: provider && String(provider).trim() ? String(provider).trim().toLowerCase() : null,
        registrar: registrar && String(registrar).trim() ? String(registrar).trim() : null,
        expires_at: parsedExpiresAt,
        auto_renew: Boolean(auto_renew),
        expected_target:
          expected_target && String(expected_target).trim()
            ? String(expected_target).trim()
            : null,
        dns_status: initialStatus,
        notes: notes && String(notes).trim() ? String(notes).trim() : null,
      })
      .select(`
        id,
        client_id,
        domain,
        provider,
        registrar,
        expires_at,
        auto_renew,
        expected_target,
        dns_status,
        dns_checked_at,
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
      const isConflict =
        insertErr?.code === "23505" ||
        String(insertErr?.message || "").toLowerCase().includes("duplicate");
      return NextResponse.json(
        {
          error: {
            code: isConflict ? "CONFLICT" : "DB_ERROR",
            message: isConflict
              ? `El dominio '${cleanDomain}' ya está registrado.`
              : insertErr?.message || "Error al crear dominio.",
          },
        },
        { status: isConflict ? 409 : 500 }
      );
    }

    // Si tiene fecha próxima a vencer o vencida, disparar evaluación de alerta inmediatamente
    if (expOverride) {
      await checkDomainExpirations(serviceClient);
    }

    return NextResponse.json(
      {
        domain: {
          ...created,
          days_left: calculateDaysLeft(created.expires_at),
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al registrar dominio.",
        },
      },
      { status: 500 }
    );
  }
}
