import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GovernanceManager, AuditManager, CancellationManager } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

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
    const { scope, workerId, enable } = body; // scope: 'worker' | 'workspace' | 'global'

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    const cm = new CancellationManager({ workspaceId: member.workspace_id, supabaseClient: supabase });

    if (scope === "worker") {
      if (!workerId) {
        return NextResponse.json(
          { error: { code: "INVALID_PARAMETERS", message: "workerId requerido para drain de worker.", statusCode: 400 } },
          { status: 400 }
        );
      }

      const decision = await governance.evaluateWorkerDrain({
        workerId,
        actorId: user.id,
        role: member.role,
        workspaceId: member.workspace_id,
        workerWorkspaceId: member.workspace_id,
      });

      if (!decision.allowed) {
        return NextResponse.json(
          { error: { code: decision.errorCode || "AUTHORIZATION_DENIED", message: decision.reason, statusCode: 403 } },
          { status: 403 }
        );
      }

      const drainRes = await cm.drainWorkerWithTimeout(workerId, 5000, user.id, "Drain manual desde UI");
      return NextResponse.json({ success: true, result: drainRes });
    }

    if (scope === "workspace") {
      // Drenar workspace requiere Owner o Admin
      const decision = await governance.evaluateAuthority({
        actorId: user.id,
        actorType: "user",
        workspaceId: member.workspace_id,
        resourceType: "workspace",
        resourceId: member.workspace_id,
        action: "workspace.settings.update",
        role: member.role,
      });

      if (!decision.allowed) {
        return NextResponse.json(
          { error: { code: decision.errorCode || "AUTHORIZATION_DENIED", message: decision.reason, statusCode: 403 } },
          { status: 403 }
        );
      }

      if (enable !== false) {
        cm.drainWorkspace(member.workspace_id);
      } else {
        cm.resumeWorkspace(member.workspace_id);
      }

      return NextResponse.json({
        success: true,
        workspaceId: member.workspace_id,
        isDraining: cm.isWorkspaceDraining(member.workspace_id),
      });
    }

    if (scope === "global") {
      // Drenar globalmente solo Owner
      if (member.role !== "owner") {
        return NextResponse.json(
          { error: { code: "AUTHORIZATION_DENIED", message: "Solo el Owner puede activar el congelamiento global.", statusCode: 403 } },
          { status: 403 }
        );
      }

      cm.setGlobalDrain(enable !== false);
      return NextResponse.json({
        success: true,
        isGlobalDrain: cm.isGlobalDrain(),
      });
    }

    return NextResponse.json(
      { error: { code: "INVALID_PARAMETERS", message: "scope desconocido.", statusCode: 400 } },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
