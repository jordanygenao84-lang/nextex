import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/roles
 * Retorna la matriz declarativa de roles base y sus permisos por defecto.
 */
export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      roles: [
        { role: "owner", name: "Propietario", permissions: DEFAULT_ROLE_PERMISSIONS.owner },
        { role: "admin", name: "Administrador", permissions: DEFAULT_ROLE_PERMISSIONS.admin },
        { role: "member", name: "Miembro Operativo", permissions: DEFAULT_ROLE_PERMISSIONS.member },
      ],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al obtener roles" }, { status: 500 });
  }
}
