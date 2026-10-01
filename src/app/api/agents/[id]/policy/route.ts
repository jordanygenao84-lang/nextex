import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPolicyEngine } from "@/lib/agents/governance/policies";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/policy
 * Obtiene la política de seguridad y riesgos del agente.
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
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data: agent } = await (supabase.from("agents") as any)
      .select("id, workspace_id")
      .eq("id", params.id)
      .single();

    if (!agent) {
      return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    }

    const { data: policy } = await (supabase.from("agent_policies") as any)
      .select("*")
      .eq("agent_id", params.id)
      .maybeSingle();

    if (!policy) {
      const defaultPol = defaultPolicyEngine.getDefaultPolicy(agent.id, agent.workspace_id);
      return NextResponse.json({ success: true, policy: defaultPol });
    }

    return NextResponse.json({ success: true, policy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al obtener política" }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/policy
 * Actualiza la política de seguridad y riesgos del agente.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data: agent } = await (supabase.from("agents") as any)
      .select("id, workspace_id")
      .eq("id", params.id)
      .single();

    if (!agent) {
      return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    }

    // Validar permiso 'agents.update'
    const canUpdate = await defaultPermissionEngine.can(user.id, agent.workspace_id, "agents.update", {
      supabaseClient: supabase,
    });

    if (!canUpdate.allowed) {
      return NextResponse.json({ error: "No tienes permiso para modificar este agente." }, { status: 403 });
    }

    const body = await req.json();
    const {
      allow_execution = true,
      allowed_tool_risks = ["read", "write"],
      approval_mode = "required",
      self_approval_mode = "blocked",
      max_concurrent_runs = 3,
    } = body;

    const { data: savedPolicy, error: saveErr } = await (supabase.from("agent_policies") as any)
      .upsert(
        {
          agent_id: agent.id,
          workspace_id: agent.workspace_id,
          allow_execution,
          allowed_tool_risks,
          approval_mode,
          self_approval_mode,
          max_concurrent_runs: Math.min(Math.max(1, Number(max_concurrent_runs) || 3), 20),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" }
      )
      .select()
      .single();

    if (saveErr) {
      return NextResponse.json({ error: saveErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, policy: savedPolicy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al actualizar política" }, { status: 500 });
  }
}
