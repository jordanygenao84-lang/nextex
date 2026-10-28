import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 * Retorna los datos básicos del usuario autenticado y su estado de superadmin.
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
        { is_super_admin: false, error: "AUTH_REQUIRED" },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);

    return NextResponse.json({
      id: user.id,
      email: user.email,
      is_super_admin: superAdmin,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
