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

    const { data: workers, error } = await (supabase.from("workers") as any)
      .select("*, worker_leases(id, status, job_run_id, leased_at, expires_at)")
      .eq("workspace_id", member.workspace_id)
      .order("registered_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      workers: (workers || []).map((w: any) => ({
        ...w,
        activeLeasesCount: (w.worker_leases || []).filter((l: any) => l.status === "active").length,
      })),
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
    const { workerId, action, reason, targetWorkspaceId } = body;

    if (!workerId || !action) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "workerId y action son obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    // Worker actions must have a transactional control-plane operation.
    // Per-worker recovery is handled by the workspace recovery endpoint, and
    // restart requires a worker command channel that this registry does not expose.
    if (action === "recover" || action === "restart") {
      return NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_WORKER_ACTION",
            message:
              action === "recover"
                ? "Use la acción de recuperación del workspace para ejecutar el ciclo autorizado."
                : "Este worker no ofrece un canal transaccional de reinicio.",
            statusCode: 409,
          },
        },
        { status: 409 }
      );
    }

    if (!["drain", "quarantine", "release_quarantine"].includes(action)) {
      return NextResponse.json(
        { error: { code: "INVALID_ACTION", message: "Acción de worker no válida.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    // 1. Obtener el worker y validar existencia
    const { data: targetWorker } = await (supabase.from("workers") as any)
      .select("*")
      .eq("id", workerId)
      .maybeSingle();

    if (!targetWorker) {
      return NextResponse.json(
        { error: { code: "WORKER_NOT_FOUND", message: "Worker no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    // 2. Evaluar Gobernanza y Autoridad de la Acción (H09, H10, H38, H39, H40, H41)
    let decisionResult;

    if (action === "drain") {
      decisionResult = await governance.evaluateWorkerDrain({
        workerId,
        actorId: user.id,
        role: member.role,
        workspaceId: member.workspace_id,
        workerWorkspaceId: targetWorkspaceId || targetWorker.workspace_id,
      });
    } else if (action === "quarantine") {
      decisionResult = await governance.evaluateWorkerQuarantine({
        workerId,
        actorId: user.id,
        role: member.role,
        workspaceId: member.workspace_id,
        workerWorkspaceId: targetWorkspaceId || targetWorker.workspace_id,
      });
    } else if (action === "release_quarantine") {
      decisionResult = await governance.evaluateAuthority({
        actorId: user.id,
        actorType: "user",
        workspaceId: member.workspace_id,
        resourceType: "worker",
        resourceId: workerId,
        action: "workers.quarantine",
        role: member.role,
        targetWorkspaceId: targetWorkspaceId || targetWorker.workspace_id,
      });
    } else {
      decisionResult = await governance.evaluateAuthority({
        actorId: user.id,
        actorType: "user",
        role: member.role,
        workspaceId: member.workspace_id,
        resourceType: "worker",
        resourceId: workerId,
        action,
        targetWorkspaceId: targetWorkspaceId || targetWorker.workspace_id,
      });
    }

    if (!decisionResult.allowed) {
      return NextResponse.json(
        {
          decision: decisionResult.decision,
          error: {
            code: decisionResult.errorCode || "AUTHORIZATION_DENIED",
            message: `Acción no autorizada: ${decisionResult.reason}`,
            statusCode: decisionResult.errorCode === "TENANT_MISMATCH" ? 403 : 403,
          },
        },
        { status: 403 }
      );
    }

    // 3. Ejecutar la mutación autorizada vía RPC o actualización segura
    let rpcResponse: any;
    // The deployed Supabase client currently does not infer RPC Args from the
    // hand-maintained Database type; signatures are kept in sync in types.ts.
    const controlPlaneRpc = supabase as any;
    if (action === "drain") {
      rpcResponse = await controlPlaneRpc.rpc("drain_worker", {
        p_worker_id: workerId,
        p_actor_id: user.id,
        p_reason: reason || "Drenado solicitado desde UI de Control Plane",
      });
    } else if (action === "quarantine") {
      rpcResponse = await controlPlaneRpc.rpc("quarantine_worker", {
        p_worker_id: workerId,
        p_actor_id: user.id,
        p_reason: reason || "Cuarentena aplicada desde UI de Control Plane",
      });
    } else if (action === "release_quarantine") {
      rpcResponse = await controlPlaneRpc.rpc("release_worker_quarantine", {
        p_worker_id: workerId,
        p_actor_id: user.id,
      });
    }

    if (rpcResponse?.error) throw rpcResponse.error;
    if (rpcResponse?.data?.success === false) {
      return NextResponse.json(
        {
          decision: "allow",
          result: rpcResponse.data,
          error: {
            code: rpcResponse.data.error_code || "WORKER_ACTION_FAILED",
            message: rpcResponse.data.error_message || "La operación del worker no se completó.",
            statusCode: 409,
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      decision: "allow",
      result: rpcResponse?.data || { success: true },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
