import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AgentErrorCodes } from "@/lib/agents/types/errors";
import { CreateAgentDTO } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents
 * Lista todos los agentes pertenecientes al workspace autenticado.
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    let query = (supabase.from("agents") as any).select("*, agent_tools(tool_id, enabled)");

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data: agents, error } = await query.order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ agents: agents || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message || "Error al listar agentes.", statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents
 * Crea un nuevo agente dentro del workspace autorizado.
 */
export async function POST(req: NextRequest) {
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

    const body: CreateAgentDTO = await req.json();

    if (!body.name?.trim() || !body.system_instructions?.trim() || !body.model_id?.trim()) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INVALID_AGENT_DATA,
            message: "Nombre, instrucciones del sistema y modelo son campos obligatorios.",
            statusCode: 400,
          },
        },
        { status: 400 }
      );
    }

    let targetWorkspaceId = body.workspace_id;
    if (!targetWorkspaceId) {
      const { data: personalWs } = (await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()) as any;

      targetWorkspaceId = personalWs?.id;
    }

    if (!targetWorkspaceId) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.AGENT_PERMISSION_DENIED,
            message: "No se encontró un workspace válido para asignar el agente.",
            statusCode: 400,
          },
        },
        { status: 400 }
      );
    }

    // 1. Insertar agente
    const { data: agent, error: agentErr } = await ((supabase
      .from("agents") as any)
      .insert({
        workspace_id: targetWorkspaceId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        system_instructions: body.system_instructions.trim(),
        model_id: body.model_id.trim(),
        status: body.status || "draft",
        max_steps: body.max_steps || 10,
        max_tokens: body.max_tokens || 8000,
        timeout_seconds: body.timeout_seconds || 60,
        max_tool_calls: body.max_tool_calls ?? 5,
        created_by: user.id,
      })
      .select()
      .single() as any);

    if (agentErr || !agent) {
      throw agentErr || new Error("Fallo al crear agente en la base de datos.");
    }

    // 2. Asociar herramientas autorizadas si se especificaron
    if (body.tool_ids && Array.isArray(body.tool_ids) && body.tool_ids.length > 0) {
      const toolsToInsert = body.tool_ids.map((toolId) => ({
        agent_id: agent.id,
        tool_id: toolId,
        enabled: true,
      }));

      await (supabase.from("agent_tools") as any).insert(toolsToInsert);
    }

    return NextResponse.json({ agent }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: AgentErrorCodes.INTERNAL_AGENT_ERROR,
          message: err?.message || "Error al procesar la creación del agente.",
          statusCode: 500,
        },
      },
      { status: 500 }
    );
  }
}
