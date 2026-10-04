import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

    const { data: worker, error: workerErr } = await (supabase.from("workers") as any)
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    if (workerErr) throw workerErr;
    if (!worker) {
      return NextResponse.json(
        { error: { code: "WORKER_NOT_FOUND", message: "Worker no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    // Aislamiento Multi-Tenant
    if (worker.workspace_id !== member.workspace_id) {
      return NextResponse.json(
        { error: { code: "TENANT_MISMATCH", message: "Acceso denegado a recurso de otro workspace.", statusCode: 403 } },
        { status: 403 }
      );
    }

    // Leases activos e históricos
    const { data: leases } = await (supabase.from("worker_leases") as any)
      .select("*, job_runs(id, job_id, status, fencing_token)")
      .eq("worker_id", worker.id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Auditoría histórica del worker
    const { data: auditEvents } = await (supabase.from("worker_audit_log") as any)
      .select("*")
      .eq("worker_id", worker.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({
      worker,
      leases: leases || [],
      auditEvents: auditEvents || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
