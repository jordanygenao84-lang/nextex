import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAuthorizationEngine } from "@/lib/agents/governance/authorization";
import { defaultMemoryService } from "@/lib/agents/memory/service";
import { AgentErrorCodes } from "@/lib/agents/types/errors";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/agents/[id]/memories/[memoryId]
 * Modifica estado o contenido de una memoria (requiere 'memory.manage').
 * No permite modificar workspace_id ni convertir a trust_level=system.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; memoryId: string } }
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

    const { data: agent, error: agentErr } = await (supabase
      .from("agents")
      .select("id, workspace_id")
      .eq("id", params.id)
      .single() as any);

    if (agentErr || !agent) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Agente no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { status, content, summary, expires_at, trust_level } = body;

    // Regla de seguridad: Ningún cliente puede asignar trust_level=system
    if (trust_level === "system") {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.PERMISSION_DENIED, message: "Prohibición: trust_level='system' no puede asignarse vía API.", statusCode: 403 } },
        { status: 403 }
      );
    }

    // 1. Autorización JIT 'memory.manage'
    const authz = await defaultAuthorizationEngine.evaluateMemoryAccess(
      { userId: user.id, workspaceId: agent.workspace_id, agentId: agent.id },
      "manage",
      { supabaseClient: supabase }
    );

    if (authz.decision !== "allow") {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.PERMISSION_DENIED, message: authz.reason, statusCode: 403 } },
        { status: 403 }
      );
    }

    // 2. Si es aprobación de cuarentena
    if (status === "active") {
      const apprRes = await defaultMemoryService.approveQuarantine(params.memoryId, {
        workspaceId: agent.workspace_id,
        userId: user.id,
        agentId: agent.id,
        supabaseClient: supabase,
      });

      if (!apprRes.success) {
        return NextResponse.json(
          { error: { code: apprRes.error_code || AgentErrorCodes.INTERNAL_AGENT_ERROR, message: apprRes.error_message, statusCode: 400 } },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true, status: "active", trust_level: "verified" });
    }

    // 3. Actualización de otros campos permitidos
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (status && ["archived", "deprecated", "quarantined"].includes(status)) {
      updatePayload.status = status;
    }
    if (content && typeof content === "string") {
      updatePayload.content = content.trim();
    }
    if (summary !== undefined) {
      updatePayload.summary = summary ? summary.trim() : null;
    }
    if (expires_at !== undefined) {
      updatePayload.expires_at = expires_at;
    }

    const { data: updated, error: updateErr } = await ((supabase
      .from("agent_memories") as any)
      .update(updatePayload)
      .eq("id", params.memoryId)
      .eq("workspace_id", agent.workspace_id)
      .select()
      .single() as any);

    if (updateErr) throw updateErr;

    // Registrar en auditoría
    await (supabase.from("agent_memory_access_log") as any).insert({
      workspace_id: agent.workspace_id,
      memory_id: params.memoryId,
      agent_id: agent.id,
      actor_id: user.id,
      operation: status === "archived" ? "archive" : "write",
      metadata: { updatePayload },
    });

    return NextResponse.json({ success: true, memory: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[id]/memories/[memoryId]
 * Purgado físico de una memoria preservando el historial inmutable de auditoría (requiere 'memory.delete').
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; memoryId: string } }
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

    const { data: agent, error: agentErr } = await (supabase
      .from("agents")
      .select("id, workspace_id")
      .eq("id", params.id)
      .single() as any);

    if (agentErr || !agent) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Agente no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const delRes = await defaultMemoryService.deleteMemory(params.memoryId, {
      workspaceId: agent.workspace_id,
      userId: user.id,
      agentId: agent.id,
      supabaseClient: supabase,
    });

    if (!delRes.success) {
      return NextResponse.json(
        { error: { code: delRes.error_code || AgentErrorCodes.INTERNAL_AGENT_ERROR, message: delRes.error_message, statusCode: 400 } },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, deletedId: params.memoryId });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
