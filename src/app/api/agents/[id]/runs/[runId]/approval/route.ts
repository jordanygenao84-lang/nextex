import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAgentRuntime } from "@/lib/agents/runtime/runtime";
import { AgentErrorCodes } from "@/lib/agents/types/errors";
import { RunApprovalDTO } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/runs/[runId]/approval
 * Resuelve una solicitud de aprobación humana para una herramienta de riesgo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; runId: string } }
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
            message: "Sesión requerida para autorizar ejecuciones.",
            statusCode: 401,
          },
        },
        { status: 401 }
      );
    }

    const body: RunApprovalDTO = await req.json();

    if (!body.step_id || !["approve", "reject"].includes(body.action)) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INVALID_AGENT_DATA,
            message: "Parámetros inválidos. Se requiere 'step_id' y 'action' ('approve' o 'reject').",
            statusCode: 400,
          },
        },
        { status: 400 }
      );
    }

    // Verificar que el run exista y pertenezca al workspace del usuario
    const { data: run, error: runErr } = await (supabase.from("agent_runs") as any)
      .select("id, workspace_id, agent_id, status")
      .eq("id", params.runId)
      .single();

    if (runErr || !run) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.AGENT_NOT_FOUND,
            message: "Run no encontrado.",
            statusCode: 404,
          },
        },
        { status: 404 }
      );
    }

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", run.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
            message: "No perteneces al workspace de este agente.",
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    // Reanudar la ejecución con la decisión humana
    const result = await defaultAgentRuntime.resumeRunWithApproval(
      params.runId,
      body.step_id,
      body.action,
      body.comment,
      supabase,
      user.id
    );

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err?.statusCode || 500;
    return NextResponse.json(
      {
        error: {
          code: err?.code || AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: err?.message || "Error al procesar la aprobación del agente.",
          statusCode,
        },
      },
      { status: statusCode }
    );
  }
}
