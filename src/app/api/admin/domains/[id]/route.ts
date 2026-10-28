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
 * PATCH /api/admin/domains/[id]
 * Actualiza los datos de un dominio en el inventario.
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

    const domainId = params.id;
    const serviceClient = createServiceClient();

    const { data: existing, error: findErr } = await (
      serviceClient.from("domains") as any
    )
      .select("*")
      .eq("id", domainId)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Dominio no encontrado." } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.domain !== undefined) {
      const clean = normalizeDomainName(body.domain);
      if (!clean) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'domain' no puede estar vacío.",
            },
          },
          { status: 400 }
        );
      }
      updates.domain = clean;
    }

    if (body.client_id !== undefined) {
      updates.client_id =
        body.client_id && String(body.client_id).trim()
          ? String(body.client_id).trim()
          : null;
    }

    if (body.provider !== undefined) {
      updates.provider =
        body.provider && String(body.provider).trim()
          ? String(body.provider).trim().toLowerCase()
          : null;
    }

    if (body.registrar !== undefined) {
      updates.registrar =
        body.registrar && String(body.registrar).trim()
          ? String(body.registrar).trim()
          : null;
    }

    if (body.expires_at !== undefined) {
      if (body.expires_at === null || String(body.expires_at).trim() === "") {
        updates.expires_at = null;
      } else {
        const trimmedDate = String(body.expires_at).trim();
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
        updates.expires_at = trimmedDate;
      }

      const expOverride = computeExpirationOverrideStatus(updates.expires_at);
      if (expOverride) {
        updates.dns_status = expOverride;
      } else if (
        existing.dns_status === "expiring" ||
        existing.dns_status === "expired"
      ) {
        updates.dns_status = existing.dns_checked_at ? "ok" : "unknown";
      }
    }

    if (body.auto_renew !== undefined) {
      updates.auto_renew = Boolean(body.auto_renew);
    }

    if (body.expected_target !== undefined) {
      updates.expected_target =
        body.expected_target && String(body.expected_target).trim()
          ? String(body.expected_target).trim()
          : null;
    }

    if (body.notes !== undefined) {
      updates.notes =
        body.notes && String(body.notes).trim()
          ? String(body.notes).trim()
          : null;
    }

    const { data: updated, error: updateErr } = await (
      serviceClient.from("domains") as any
    )
      .update(updates)
      .eq("id", domainId)
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

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR", message: "Error interno del servidor.",
          },
        },
        { status: 500 }
      );
    }

    if (computeExpirationOverrideStatus(updated.expires_at)) {
      await checkDomainExpirations(serviceClient);
    }

    return NextResponse.json({
      domain: {
        ...updated,
        days_left: calculateDaysLeft(updated.expires_at),
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

/**
 * DELETE /api/admin/domains/[id]
 * Elimina un dominio del inventario.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function DELETE(
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

    const domainId = params.id;
    const serviceClient = createServiceClient();

    const { error: delErr } = await (serviceClient.from("domains") as any)
      .delete()
      .eq("id", domainId);

    if (delErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Dominio eliminado correctamente.",
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
