import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { executeVigiaHealthChecks } from "@/lib/vigia/health";

export const dynamic = "force-dynamic";

/**
 * POST /api/vigia/check-now
 * Dispara inmediatamente el chequeo de salud web para todos los clientes activos,
 * omitiendo la puerta de debounce de 5 minutos.
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

    const serviceClient = createServiceClient();
    const result = await executeVigiaHealthChecks(serviceClient, { force: true });

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
