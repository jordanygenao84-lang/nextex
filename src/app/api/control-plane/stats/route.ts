import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Resolver workspace_id del usuario
    const { data: member } = await (supabase.from("workspace_members") as any)
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const workspaceId = member?.workspace_id;
    if (!workspaceId) {
      return NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "Usuario sin workspace activo.", statusCode: 403 } },
        { status: 403 }
      );
    }

    // 1. Estadísticas de Workers
    const { data: workers } = await (supabase.from("workers") as any)
      .select("id, status")
      .eq("workspace_id", workspaceId);

    const workerList = workers || [];
    const workerStats = {
      total: workerList.length,
      healthy: workerList.filter((w: any) => w.status === "HEALTHY").length,
      starting: workerList.filter((w: any) => w.status === "STARTING").length,
      draining: workerList.filter((w: any) => w.status === "DRAINING").length,
      stale: workerList.filter((w: any) => w.status === "STALE").length,
      quarantined: workerList.filter((w: any) => w.status === "QUARANTINED").length,
      stopped: workerList.filter((w: any) => w.status === "STOPPED").length,
    };

    // 2. Estadísticas de Jobs / Runs
    const { data: runs } = await (supabase.from("job_runs") as any)
      .select("id, status")
      .eq("workspace_id", workspaceId);

    const runList = runs || [];
    const jobStats = {
      total: runList.length,
      queued: runList.filter((r: any) => r.status === "queued").length,
      claimed: runList.filter((r: any) => r.status === "claimed").length,
      running: runList.filter((r: any) => r.status === "running").length,
      waiting_approval: runList.filter((r: any) => r.status === "waiting_approval").length,
      completed: runList.filter((r: any) => r.status === "completed").length,
      failed: runList.filter((r: any) => r.status === "failed").length,
      cancelled: runList.filter((r: any) => r.status === "cancelled").length,
      dead_letter: runList.filter((r: any) => r.status === "dead_letter").length,
    };

    // 3. Estadísticas de Recuperación & Leases
    const { data: leases } = await (supabase.from("worker_leases") as any)
      .select("id, status, expires_at")
      .eq("workspace_id", workspaceId);

    const leaseList = leases || [];
    const now = Date.now();
    const recoveryStats = {
      total_leases: leaseList.length,
      active_leases: leaseList.filter((l: any) => l.status === "active").length,
      expired_leases: leaseList.filter(
        (l: any) => l.status === "expired" || (l.status === "active" && new Date(l.expires_at).getTime() < now)
      ).length,
      recovery_attempts: runList.filter((r: any) => r.status === "retry_scheduled").length,
      fencing_events: runList.filter((r: any) => Number(r.fencing_token || 0) > 1).length,
      recovery_failures: runList.filter((r: any) => r.status === "dead_letter").length,
    };

    // 4. Estadísticas de Gobernanza & Auditoría
    const { data: auditEvents } = await (supabase.from("control_plane_audit_log") as any)
      .select("id, decision, action, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);

    const auditList = auditEvents || [];
    const governanceStats = {
      total_evaluations: auditList.length,
      allowed: auditList.filter((a: any) => a.decision === "allow").length,
      denied: auditList.filter((a: any) => a.decision === "deny").length,
      requires_approval: auditList.filter((a: any) => a.decision === "requires_approval").length,
      blocked: auditList.filter((a: any) => a.decision === "blocked").length,
      expired: auditList.filter((a: any) => a.decision === "expired").length,
    };

    // 5. Estadísticas de Cancelación
    const cancellationStats = {
      requested: runList.filter((r: any) => r.status === "cancellation_requested").length,
      cancelling: runList.filter((r: any) => r.status === "cancelling").length,
      cancelled: runList.filter((r: any) => r.status === "cancelled").length,
      failed_cancellation: 0,
    };

    return NextResponse.json({
      workspaceId,
      userRole: member.role,
      workers: workerStats,
      jobs: jobStats,
      recovery: recoveryStats,
      governance: governanceStats,
      cancellation: cancellationStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
