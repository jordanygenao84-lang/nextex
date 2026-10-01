import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CANONICAL_PERMISSIONS_CATALOG } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/permissions
 * Retorna el catálogo canónico de los 22 permisos del sistema.
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
      permissions: CANONICAL_PERMISSIONS_CATALOG,
      total: CANONICAL_PERMISSIONS_CATALOG.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al obtener permisos" }, { status: 500 });
  }
}
