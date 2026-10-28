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
 * PATCH /api/admin/credentials/[id]
 * Actualiza los campos de una credencial en el inventario.
 * updated_at = now()
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

    const credentialId = params.id;
    if (!credentialId) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "ID de credencial requerido." } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: existing, error: findErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .select("id")
      .eq("id", credentialId)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Credencial no encontrada." } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: { code: "VALIDATION_ERROR", message: "El campo 'name' no puede estar vacío." } },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body.provider !== undefined) {
      const p = String(body.provider).trim().toLowerCase();
      if (!VALID_PROVIDERS.includes(p as any)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: `El campo 'provider' debe ser uno de: ${VALID_PROVIDERS.join(", ")}.`,
            },
          },
          { status: 400 }
        );
      }
      updates.provider = p;
    }

    if (body.client_id !== undefined) {
      updates.client_id = body.client_id || null;
    }

    if (body.location !== undefined) {
      updates.location = body.location && typeof body.location === "string" ? body.location.trim() : null;
    }

    if (body.expires_at !== undefined) {
      if (body.expires_at === null || body.expires_at === "") {
        updates.expires_at = null;
      } else {
        const trimmed = String(body.expires_at).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          updates.expires_at = trimmed;
        } else {
          return NextResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "El campo 'expires_at' debe tener el formato YYYY-MM-DD o ser null.",
              },
            },
            { status: 400 }
          );
        }
      }
    }

    if (body.alert_days_before !== undefined) {
      if (isNaN(Number(body.alert_days_before))) {
        return NextResponse.json(
          { error: { code: "VALIDATION_ERROR", message: "El campo 'alert_days_before' debe ser un número entero." } },
          { status: 400 }
        );
      }
      updates.alert_days_before = Math.max(0, parseInt(String(body.alert_days_before), 10));
    }

    if (body.notes !== undefined) {
      updates.notes = body.notes && typeof body.notes === "string" ? body.notes.trim() : null;
    }

    const { data: updated, error: updateErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .update(updates)
      .eq("id", credentialId)
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

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    const days_left = calculateDaysLeft(updated.expires_at);
    const status = computeCredentialStatus(days_left, updated.alert_days_before);

    return NextResponse.json({
      credential: {
        ...updated,
        days_left,
        status,
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
 * DELETE /api/admin/credentials/[id]
 * Elimina una credencial del inventario.
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

    const credentialId = params.id;
    if (!credentialId) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "ID de credencial requerido." } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: existing, error: findErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .select("id")
      .eq("id", credentialId)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Credencial no encontrada." } },
        { status: 404 }
      );
    }

    const { error: delErr } = await (
      serviceClient.from("credentials_inventory") as any
    )
      .delete()
      .eq("id", credentialId);

    if (delErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Credencial eliminada exitosamente.",
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
