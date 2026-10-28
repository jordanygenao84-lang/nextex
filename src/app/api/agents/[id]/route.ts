import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AuditManager } from "@/lib/control-plane";
import { AgentErrorCodes } from "@/lib/agents/types/errors";
import { UpdateAgentDTO } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]
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

    const { data: agent, error } = await ((supabase
      .from("agents") as any)
      .select("*, agent_tools(tool_id, enabled)")
      .eq("id", params.id)
      .single() as any);

    if (error || !agent) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Agente no encontrado o sin acceso.", statusCode: 404 } },
        { status: 404 }
      );
    }

    return NextResponse.json({ agent });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agents/[id]
 */
export async function PATCH(
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

    const body: UpdateAgentDTO = await req.json();

    const updatePayload: Record<string, any> = {};
    if (body.name !== undefined) updatePayload.name = body.name.trim();
    if (body.description !== undefined) updatePayload.description = body.description?.trim() || null;
    if (body.system_instructions !== undefined) updatePayload.system_instructions = body.system_instructions.trim();
    if (body.model_id !== undefined) updatePayload.model_id = body.model_id.trim();
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.max_steps !== undefined) updatePayload.max_steps = body.max_steps;
    if (body.max_tokens !== undefined) updatePayload.max_tokens = body.max_tokens;
    if (body.timeout_seconds !== undefined) updatePayload.timeout_seconds = body.timeout_seconds;
    if (body.max_tool_calls !== undefined) updatePayload.max_tool_calls = body.max_tool_calls;

    const { data: updatedAgent, error } = await ((supabase
      .from("agents") as any)
      .update(updatePayload)
      .eq("id", params.id)
      .select()
      .single() as any);

    if (error || !updatedAgent) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.AGENT_NOT_FOUND, message: "No se pudo actualizar el agente.", statusCode: 404 } },
        { status: 404 }
      );
    }

    // Actualizar tools si se especificaron
    if (body.tool_ids && Array.isArray(body.tool_ids)) {
      await (supabase.from("agent_tools") as any).delete().eq("agent_id", params.id);
      if (body.tool_ids.length > 0) {
        const toolsToInsert = body.tool_ids.map((toolId) => ({
          agent_id: params.id,
          tool_id: toolId,
          enabled: true,
        }));
        await (supabase.from("agent_tools") as any).insert(toolsToInsert);
      }
    }

    return NextResponse.json({ agent: updatedAgent });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[id]
 */
export async function DELETE(
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

    // Por defecto, archivar el agente de forma segura
    const { data: archived, error } = await (supabase
      .from("agents") as any)
      .update({ status: "archived" })
      .eq("id", params.id)
      .select("id, workspace_id, name")
      .single();

    if (error) throw error;

    // Auditoría del archivado (mismo hueco que la creación).
    try {
      if (archived?.workspace_id) {
        const audit = new AuditManager({ workspaceId: archived.workspace_id, supabaseClient: createServiceClient() });
        await audit.recordEvent({
          workspaceId: archived.workspace_id,
          actorId: user.id,
          actorType: "user",
          action: "agent.archived",
          resourceType: "agent",
          resourceId: archived.id,
          decision: "allow",
          reason: `Agente archivado: ${archived.name || archived.id}`,
        });
      }
    } catch {
      // Auditoría best-effort.
    }

    return NextResponse.json({ success: true, message: "Agente archivado correctamente." });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
