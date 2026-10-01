import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAgentRuntime } from "@/lib/agents/runtime/runtime";
import { AgentError, AgentErrorCodes } from "@/lib/agents/types/errors";
import { Agent } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/runs
 * Lista las ejecuciones previas de este agente.
 */
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
        { error: { code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const { data: runs, error } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("agent_id", params.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ runs: runs || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents/[id]/runs
 * Despacha la ejecución controlada de un agente.
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
        { error: { code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { input, override_max_tokens, override_timeout_seconds, override_max_steps } = body;

    if (!input || typeof input !== "string" || !input.trim()) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.INVALID_AGENT_DATA, message: "El campo 'input' es obligatorio.", statusCode: 400 } },
        { status: 400 }
      );
    }

    // 1. Obtener datos del agente
    const { data: agentData, error: agentErr } = await (supabase
      .from("agents")
      .select("*, agent_tools(tool_id, enabled)")
      .eq("id", params.id)
      .single() as any);

    if (agentErr || !agentData) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Agente no encontrado o sin permisos.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const agent: Agent = {
      ...agentData,
      tools: agentData.agent_tools?.filter((t: any) => t.enabled).map((t: any) => t.tool_id) || [],
    };

    // 2. Ejecutar a través de Agent Runtime
    const result = await defaultAgentRuntime.executeRun(
      agent,
      {
        agent_id: agent.id,
        workspace_id: agent.workspace_id,
        user_id: user.id,
        input: input.trim(),
        override_max_tokens,
        override_timeout_seconds,
        override_max_steps,
      },
      supabase
    );

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err: any) {
    if (err instanceof AgentError) {
      return NextResponse.json({ error: err.toJSON() }, { status: err.statusCode });
    }

    return NextResponse.json(
      {
        error: {
          code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: err?.message || "Fallo inesperado en la ejecución del agente.",
          statusCode: 500,
        },
      },
      { status: 500 }
    );
  }
}
