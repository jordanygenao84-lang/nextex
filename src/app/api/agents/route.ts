import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AuditManager } from "@/lib/control-plane";
import { AgentErrorCodes } from "@/lib/agents/types/errors";
import { CreateAgentDTO } from "@/lib/agents/types";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { defaultQuotaManager } from "@/lib/omniengine/quotas/quota-manager";
import { defaultToolRegistry } from "@/lib/agents/tools/registry";

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

    let query = (supabase.from("agents") as any)
      .select("*, agent_tools(tool_id, enabled)")
      .neq("status", "archived");

    if (workspaceId) {
      // H-012: Validar membresía real en workspace_members antes de filtrar
      const { data: member, error: memberErr } = await (supabase
        .from("workspace_members") as any)
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (memberErr || !member) {
        return NextResponse.json(
          { error: { code: "PERMISSION_DENIED", message: "No eres miembro de ese workspace." } },
          { status: 403 }
        );
      }

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

    // H-012: Validar membresía real en targetWorkspaceId antes del insert
    const { data: member, error: memberErr } = await (supabase
      .from("workspace_members") as any)
      .select("role")
      .eq("workspace_id", targetWorkspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberErr || !member) {
      return NextResponse.json(
        { error: { code: "PERMISSION_DENIED", message: "No eres miembro de ese workspace." } },
        { status: 403 }
      );
    }

    // H-013 a: Exigir permiso agents.create
    const canCreate = await defaultPermissionEngine.can(user.id, targetWorkspaceId, "agents.create", { supabaseClient: supabase });
    if (!canCreate.allowed) {
      return NextResponse.json(
        { error: { code: "PERMISSION_DENIED", message: canCreate.reason } },
        { status: 403 }
      );
    }

    // H-013 b: Estado activo del usuario en profiles (fail-closed)
    const { data: userProfile, error: profileErr } = await (supabase
      .from("profiles") as any)
      .select("status, plan")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !userProfile || userProfile.status !== "active") {
      return NextResponse.json(
        { error: { code: "ACCOUNT_SUSPENDED", message: "Cuenta suspendida o perfil no verificado." } },
        { status: 403 }
      );
    }

    // H-013 c: Estado activo de la empresa si existe fila en clients
    const { data: clientRow } = await (supabase
      .from("clients") as any)
      .select("status")
      .eq("workspace_id", targetWorkspaceId)
      .maybeSingle();

    if (clientRow && clientRow.status !== "active") {
      return NextResponse.json(
        { error: { code: "ACCOUNT_SUSPENDED", message: "El servicio del workspace está suspendido." } },
        { status: 403 }
      );
    }

    // H-013 d: Límites de plan (maxAgents)
    const planPolicy = defaultQuotaManager.getPolicy((userProfile.plan as any) || "free");
    if (typeof planPolicy.maxAgents === "number") {
      const { count, error: countErr } = await (supabase
        .from("agents") as any)
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", targetWorkspaceId)
        .neq("status", "archived");

      if (!countErr && count !== null && count >= planPolicy.maxAgents) {
        return NextResponse.json(
          {
            error: {
              code: AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
              message: "Has alcanzado el límite de agentes de tu plan.",
            },
          },
          { status: 429 }
        );
      }
    }

    // H-014 a: Validar tool_ids contra el registro antes de insertar
    if (body.tool_ids && Array.isArray(body.tool_ids) && body.tool_ids.length > 0) {
      for (const toolId of body.tool_ids) {
        const tool = defaultToolRegistry.getTool(toolId);
        if (!tool) {
          return NextResponse.json(
            {
              error: {
                code: AgentErrorCodes.TOOL_NOT_FOUND,
                message: `Herramienta desconocida o no registrada: '${toolId}'.`,
                statusCode: 400,
              },
            },
            { status: 400 }
          );
        }
      }
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

    // 2. Asociar herramientas autorizadas si se especificaron (H-014 b: compensación ante error)
    if (body.tool_ids && Array.isArray(body.tool_ids) && body.tool_ids.length > 0) {
      const toolsToInsert = body.tool_ids.map((toolId) => ({
        agent_id: agent.id,
        tool_id: toolId,
        enabled: true,
      }));

      const { error: toolsErr } = await (supabase.from("agent_tools") as any).insert(toolsToInsert);
      if (toolsErr) {
        const { error: deleteErr } = await (supabase.from("agents") as any).delete().eq("id", agent.id);
        if (deleteErr) {
          return NextResponse.json(
            {
              error: {
                code: "AGENT_TOOLS_FAILED",
                message: `El agente se creó pero no se pudieron asociar sus herramientas, y la compensación falló. Quedó un agente huérfano con id '${agent.id}' para limpieza manual. Error de herramientas: ${toolsErr.message}`,
              },
            },
            { status: 500 }
          );
        }
        return NextResponse.json(
          {
            error: {
              code: "AGENT_TOOLS_FAILED",
              message: "El agente se creó pero no se pudieron asociar sus herramientas; se eliminó para no dejarlo huérfano.",
            },
          },
          { status: 500 }
        );
      }
    }

    // 3. Auditoría: el ciclo de vida de agentes no se veía en el panel de
    // Control Plane (la ruta no registraba eventos). Nunca rompe la
    // creación si la auditoría falla.
    try {
      const audit = new AuditManager({ workspaceId: targetWorkspaceId, supabaseClient: createServiceClient() });
      await audit.recordEvent({
        workspaceId: targetWorkspaceId,
        actorId: user.id,
        actorType: "user",
        action: "agent.created",
        resourceType: "agent",
        resourceId: agent.id,
        decision: "allow",
        reason: `Agente creado: ${agent.name}`,
        metadata: { model_id: agent.model_id, status: agent.status },
      });
    } catch {
      // Auditoría best-effort: no bloquea la creación.
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
