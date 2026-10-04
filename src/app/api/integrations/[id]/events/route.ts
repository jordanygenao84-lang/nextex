import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/[id]/events
 * Lista los eventos recibidos para una integración dada.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: integ } = await (supabase.from("integrations") as any).select("workspace_id").eq("id", params.id).single();
    if (!integ) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });

    const canRead = await defaultPermissionEngine.can(user.id, integ.workspace_id, "integration_events.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const status = searchParams.get("status");

    let query = (supabase.from("integration_events") as any)
      .select("*")
      .eq("integration_id", params.id);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: events, error } = await query
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ events: events || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
