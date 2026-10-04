import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { defaultAgentRuntime } from "@/lib/agents/runtime/runtime";
import { defaultJobQueue } from "@/lib/jobs/queue/queue";
import { AgentErrorCodes } from "@/lib/agents/types/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id]/reject
 * Rechaza formalmente una solicitud HITL y cancela la mutación de forma segura.
 */
export async function POST(
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
        {
          error: {
            code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
            message: "Sesión requerida para rechazar solicitudes.",
          },
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const comment = body?.comment;

    // 1. Obtener la solicitud de aprobación (con cliente de sesión del usuario)
    const { data: approval, error: appErr } = await (supabase.from("approval_requests") as any)
      .select("*")
      .eq("id", params.id)
      .single();

    if (appErr || !approval) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.APPROVAL_NOT_FOUND,
            message: "Solicitud de aprobación no encontrada.",
          },
        },
        { status: 404 }
      );
    }

    // 2. Reanudar con rechazo en AgentRuntime (valida JIT y muta agent_runs con cliente del usuario)
    const result = await defaultAgentRuntime.resumeRunWithApproval(
      approval.run_id,
      approval.step_id,
      "reject",
      comment,
      supabase,
      user.id
    );

    // 3. GAP-001 & FINDING-009 REMEDIACIÓN: Si el AgentRun está vinculado a un JobRun en waiting_approval,
    // re-encolar durablemente el JobRun en la cola durable utilizando EXCLUSIVAMENTE createServiceClient() (service_role).
    const jobRunId = result.run?.job_run_id;
    if (jobRunId) {
      const serviceClient = createServiceClient();
      const { data: jobRun } = await (serviceClient.from("job_runs") as any)
        .select("id, status, fencing_token")
        .eq("id", jobRunId)
        .eq("workspace_id", approval.workspace_id)
        .maybeSingle();

      if (jobRun && jobRun.status === "waiting_approval") {
        await defaultJobQueue.checkpointAndRequeue(
          jobRun.id,
          user.id,
          jobRun.fencing_token,
          serviceClient
        );
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err?.statusCode || 500;
    return NextResponse.json(
      {
        error: {
          code: err?.code || AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: err?.message || "Error al procesar el rechazo.",
        },
      },
      { status: statusCode }
    );
  }
}
