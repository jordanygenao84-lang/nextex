import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAuthorizationEngine } from "@/lib/agents/governance/authorization";
import { defaultMemoryService } from "@/lib/agents/memory/service";
import { AgentErrorCodes } from "@/lib/agents/types/errors";
import { MemoryCandidate, MemoryScope, MemoryType } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/memories
 * Lista y filtra recuerdos del agente respetando la autorización 'memory.read'.
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

    // 1. Obtener agente para derivar workspace_id
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

    // 2. Autorización JIT 'memory.read'
    const authz = await defaultAuthorizationEngine.evaluateMemoryAccess(
      { userId: user.id, workspaceId: agent.workspace_id, agentId: agent.id },
      "read",
      { supabaseClient: supabase }
    );

    if (authz.decision !== "allow") {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.PERMISSION_DENIED, message: authz.reason, statusCode: 403 } },
        { status: 403 }
      );
    }

    // 3. Consultar memorias
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "active";
    const scope = url.searchParams.get("scope");
    const type = url.searchParams.get("type");

    let query = (supabase.from("agent_memories") as any)
      .select("id, workspace_id, agent_id, user_id, scope, type, content, summary, metadata, status, trust_level, source_run_id, source_step_id, access_count, last_accessed_at, created_at, expires_at")
      .eq("workspace_id", agent.workspace_id)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(50);

    if (scope) query = query.eq("scope", scope);
    if (type) query = query.eq("type", type);

    const { data: memories, error } = await query;
    if (error) throw error;

    return NextResponse.json({ memories: memories || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents/[id]/memories
 * Ingesta manual de una memoria de dominio o preferencia (requiere 'memory.write').
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
    const { content, type, scope, summary, metadata, client_idempotency_key, expires_at } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.INVALID_AGENT_DATA, message: "El campo 'content' es obligatorio.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const validScopes: MemoryScope[] = ["workspace", "agent", "user"];
    const targetScope: MemoryScope = validScopes.includes(scope) ? scope : "agent";
    const validTypes: MemoryType[] = ["episodic", "semantic", "fact", "preference"];
    const targetType: MemoryType = validTypes.includes(type) ? type : "fact";

    // 1. Autorización JIT 'memory.write'
    const authz = await defaultAuthorizationEngine.evaluateMemoryAccess(
      { userId: user.id, workspaceId: agent.workspace_id, agentId: agent.id },
      "write",
      {
        targetScope,
        targetTrustLevel: "untrusted",
        supabaseClient: supabase,
      }
    );

    if (authz.decision !== "allow") {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.PERMISSION_DENIED, message: authz.reason, statusCode: 403 } },
        { status: 403 }
      );
    }

    // 2. Obtener política del agente
    const { data: policyRecord } = await (supabase
      .from("agent_policies")
      .select("*")
      .eq("agent_id", agent.id)
      .maybeSingle() as any);

    const policy = policyRecord || {
      id: "default",
      agent_id: agent.id,
      workspace_id: agent.workspace_id,
      memory_enabled: true,
      memory_write_mode: "quarantined",
    };

    // 3. Ingestión con sanitización y deduplicación manual
    const candidate: MemoryCandidate = {
      content: content.trim(),
      type: targetType,
      scope: targetScope,
      summary: summary?.trim() || null,
      metadata: metadata || {},
      expiresAt: expires_at || null,
    };

    const ingestResult = await defaultMemoryService.ingestMemory(candidate, {
      agentId: agent.id,
      workspaceId: agent.workspace_id,
      userId: user.id,
      policy,
      client_idempotency_key: client_idempotency_key || null,
      supabaseClient: supabase,
    });

    if (!ingestResult.success) {
      return NextResponse.json(
        { error: { code: ingestResult.error_code || AgentErrorCodes.INTERNAL_AGENT_ERROR, message: ingestResult.error_message, statusCode: 400 } },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      id: ingestResult.memoryId,
      status: ingestResult.status,
      cached: ingestResult.cached,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
