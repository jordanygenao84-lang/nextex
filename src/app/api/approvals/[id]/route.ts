import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/[id]
 * Retorna el detalle de una solicitud de aprobación específica.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data: approval, error } = await supabase
      .from("approval_requests")
      .select("*, agent_runs(agent_id, input, status), agent_run_steps(input)")
      .eq("id", params.id)
      .single();

    if (error || !approval) {
      return NextResponse.json({ error: "Solicitud de aprobación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true, approval });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al obtener solicitud" }, { status: 500 });
  }
}
