import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GovernanceManager, AuditManager, RecoveryManager } from "@/lib/control-plane";

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

    // Consultar Workers en estado STALE o con latidos atrasados
    const { data: staleWorkers } = await (supabase.from("workers") as any)
      .select("*")
      .eq("workspace_id", member.workspace_id)
      .in("status", ["STALE", "QUARANTINED"]);

    // Consultar Leases expirados
    const { data: expiredLeases } = await (supabase.from("worker_leases") as any)
      .select("*, workers(worker_identity), job_runs(id, status, fencing_token)")
      .eq("workspace_id", member.workspace_id)
      .eq("status", "expired")
      .order("expires_at", { ascending: false })
      .limit(50);

    // Eventos de auditoría de recuperación
    const { data: recoveryEvents } = await (supabase.from("job_audit_log") as any)
      .select("*")
      .eq("workspace_id", member.workspace_id)
      .in("action", [
        "worker_stale",
        "lease_expired",
        "job_recovery_started",
        "job_recovery_claimed",
        "job_recovery_rejected",
        "zombie_execution_rejected",
        "recovery_completed",
      ])
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({
      staleWorkers: staleWorkers || [],
      expiredLeases: expiredLeases || [],
      recoveryEvents: recoveryEvents || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
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

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    // Validar autorización de recovery (H40, H44)
    const decision = await governance.evaluateAuthority({
      actorId: user.id,
      actorType: "user",
      workspaceId: member.workspace_id,
      resourceType: "recovery",
      resourceId: member.workspace_id,
      action: "workers.recover",
      role: member.role,
      permission: "workers.recover",
    });

    if (!decision.allowed) {
      return NextResponse.json(
        {
          decision: decision.decision,
          error: {
            code: decision.errorCode || "AUTHORIZATION_DENIED",
            message: `Acción no autorizada: ${decision.reason}`,
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    const rm = new RecoveryManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
    });

    const recoveryResult = await rm.runRecoveryCycle({ batchSize: 50 });

    return NextResponse.json({
      success: true,
      decision: "allow",
      result: recoveryResult,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
