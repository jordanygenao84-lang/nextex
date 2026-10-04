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

    const status = req.nextUrl.searchParams.get("status");

    let query = (supabase.from("approval_requests") as any)
      .select("*, agent_runs(id, job_run_id, agent_id), agent_steps(id, step_number, tool_id)")
      .eq("workspace_id", member.workspace_id);

    if (status) query = query.eq("status", status);

    const { data: approvals, error } = await query
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({
      approvals: approvals || [],
      currentUserId: user.id,
      currentUserRole: member.role,
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

    const body = await req.json();
    const { approvalId, action, comment, payloadHash } = body;

    if (!approvalId || !action) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "approvalId y action son obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const { data: approval } = await (supabase.from("approval_requests") as any)
      .select("*")
      .eq("id", approvalId)
      .maybeSingle();

    if (!approval) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Solicitud de aprobación no encontrada.", statusCode: 404 } },
        { status: 404 }
      );
    }

    // Aislamiento Multi-Tenant
    if (approval.workspace_id !== member.workspace_id) {
      return NextResponse.json(
        { error: { code: "TENANT_MISMATCH", message: "Acceso denegado a solicitud de otro workspace.", statusCode: 403 } },
        { status: 403 }
      );
    }

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    // Evaluar con GovernanceManager (H31-H37)
    const decision = await governance.evaluateApproval({
      workspaceId: member.workspace_id,
      approvalRequestId: approval.id,
      approverId: user.id,
      requesterId: approval.requester_id,
      approverRole: member.role,
      expectedPayloadHash: approval.payload_hash,
      actualPayloadHash: payloadHash || approval.payload_hash,
      status: approval.status,
      expiresAt: approval.expires_at,
    });

    if (!decision.allowed) {
      return NextResponse.json(
        {
          decision: decision.decision,
          error: {
            code: decision.errorCode || "AUTHORIZATION_DENIED",
            message: `Aprobación denegada por gobernanza: ${decision.reason}`,
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    // Ejecutar transición autorizada
    const newStatus = action === "approve" ? "approved" : "rejected";
    const { data: updated, error: updateErr } = await (supabase.from("approval_requests") as any)
      .update({
        status: newStatus,
        approver_id: user.id,
        comment: comment || null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", approval.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      decision: "allow",
      approval: updated,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
