import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GovernanceManager, AuditManager } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const { data: member } = await (supabase.from("workspace_members") as any)
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!member?.workspace_id) {
      return NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "Usuario sin workspace activo.", statusCode: 403 } },
        { status: 403 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status");
    const automationId = searchParams.get("automationId");
    const priority = searchParams.get("priority");
    const limit = Number(searchParams.get("limit") || 50);

    let query = (supabase.from("jobs") as any)
      .select("*, automations(id, name), job_runs(id, status, created_at, completed_at)")
      .eq("workspace_id", member.workspace_id);

    if (status) query = query.eq("status", status);
    if (automationId) query = query.eq("automation_id", automationId);
    if (priority) query = query.eq("priority", priority);

    const { data: jobs, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      jobs: (jobs || []).map((j: any) => ({
        ...j,
        runsCount: (j.job_runs || []).length,
        lastRun: (j.job_runs || []).sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0] || null,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
