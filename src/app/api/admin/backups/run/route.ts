import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { runClientBackup } from "@/lib/protection/backups";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/backups/run
 * Dispara la ejecución manual inmediata de un respaldo para un cliente (NIV1-5).
 * Body: { client_id: string }
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
    const { client_id } = body;

    if (!client_id || typeof client_id !== "string") {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'client_id' es obligatorio." } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const result = await runClientBackup(serviceClient, client_id);

    return NextResponse.json({
      success: result.status !== "failed",
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al ejecutar respaldo del cliente.",
        },
      },
      { status: 500 }
    );
  }
}
