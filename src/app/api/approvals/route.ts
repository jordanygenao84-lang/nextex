import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals?workspaceId=...&status=pending
 * Lista las solicitudes de aprobación del workspace.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const status = searchParams.get("status");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId requerido" }, { status: 400 });
    }

    let query = supabase
      .from("approval_requests")
      .select("*, agent_runs(agent_id, input)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (status && ["pending", "approved", "rejected", "expired", "cancelled"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data: approvals, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, approvals: approvals || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al listar aprobaciones" }, { status: 500 });
  }
}
