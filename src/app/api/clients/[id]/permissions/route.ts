import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  SECTIONS,
  ACTIONS,
  ROLES,
  Role,
  Section,
  Action,
  buildDefaultMatrix,
} from "@/lib/permissions/client-matrix";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/permissions
 * Devuelve la matriz completa de permisos por rol para el cliente.
 * Si no hay filas guardadas, devuelve preset 'dueno' para owner y todo false para los demás.
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
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // 2. Construir matriz con valores por defecto
    const matrix = buildDefaultMatrix();

    // 3. Consultar filas existentes en public.client_role_permissions
    const { data: rows, error: rowsErr } = await (serviceClient.from("client_role_permissions") as any)
      .select("role, section, action, allowed")
      .eq("client_id", clientId);

    if (rowsErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: rowsErr.message } },
        { status: 500 }
      );
    }

    // 4. Sobrescribir con los valores explícitos de la base de datos
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (
          matrix.roles[row.role as Role] &&
          matrix.roles[row.role as Role][row.section as Section] &&
          matrix.roles[row.role as Role][row.section as Section][row.action as Action] !== undefined
        ) {
          matrix.roles[row.role as Role][row.section as Section][row.action as Action] = Boolean(row.allowed);
        }
      }
    }

    return NextResponse.json(matrix);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al obtener matriz de permisos." } },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/clients/[id]/permissions
 * Body: { role, section, action, allowed }
 * Upsert de una celda específica en client_role_permissions.
 */
export async function PATCH(
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
    const { role, section, action, allowed } = body;

    // 2. Validar parámetros
    if (!role || !ROLES.includes(role)) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: `El campo 'role' debe ser uno de: ${ROLES.join(", ")}.` } },
        { status: 400 }
      );
    }

    if (!section || !SECTIONS.includes(section)) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: `El campo 'section' debe ser uno de: ${SECTIONS.join(", ")}.` } },
        { status: 400 }
      );
    }

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: `El campo 'action' debe ser uno de: ${ACTIONS.join(", ")}.` } },
        { status: 400 }
      );
    }

    if (typeof allowed !== "boolean") {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'allowed' debe ser un booleano." } },
        { status: 400 }
      );
    }

    // 3. Upsert en client_role_permissions
    const { error: upsertErr } = await (serviceClient.from("client_role_permissions") as any)
      .upsert(
        {
          client_id: clientId,
          role,
          section,
          action,
          allowed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,role,section,action" }
      );

    if (upsertErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: upsertErr.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al actualizar permiso." } },
      { status: 500 }
    );
  }
}
