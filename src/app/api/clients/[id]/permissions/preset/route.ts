import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  SECTIONS,
  ACTIONS,
  ROLES,
  PRESETS,
  Role,
} from "@/lib/permissions/client-matrix";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * POST /api/clients/[id]/permissions/preset
 * Body: { preset: 'dueno' | 'empleado' | 'lectura', role?: 'owner' | 'admin' | 'member' }
 * Borra las filas existentes de ese (client_id, role) e inserta la plantilla del preset.
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
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const { preset, role } = body;

    // 2. Validar preset
    if (!preset || !PRESETS.includes(preset)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_PARAMETERS",
            message: `El preset debe ser uno de: ${PRESETS.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Determinar rol objetivo (por defecto 'owner' para dueno, 'member' para los demás)
    let targetRole: Role = "member";
    if (role && ROLES.includes(role)) {
      targetRole = role;
    } else if (preset === "dueno") {
      targetRole = "owner";
    }

    // 4. Borrar filas existentes para ese (client_id, role)
    const { error: deleteErr } = await (serviceClient.from("client_role_permissions") as any)
      .delete()
      .eq("client_id", clientId)
      .eq("role", targetRole);

    if (deleteErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    // 5. Construir registros según las reglas del preset
    const nowIso = new Date().toISOString();
    const rows: Array<{
      client_id: string;
      role: Role;
      section: string;
      action: string;
      allowed: boolean;
      created_at: string;
      updated_at: string;
    }> = [];

    for (const section of SECTIONS) {
      for (const action of ACTIONS) {
        let allowed = false;

        if (preset === "dueno") {
          allowed = true;
        } else if (preset === "empleado") {
          if (section === "conversaciones" && (action === "ver" || action === "responder")) {
            allowed = true;
          }
        } else if (preset === "lectura") {
          if (action === "ver") {
            allowed = true;
          }
        }

        rows.push({
          client_id: clientId,
          role: targetRole,
          section,
          action,
          allowed,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    // 6. Insertar los nuevos registros del preset
    const { error: insertErr } = await (serviceClient.from("client_role_permissions") as any)
      .insert(rows);

    if (insertErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        applied: preset,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
