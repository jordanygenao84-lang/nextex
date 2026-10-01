import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAuthorizationEngine } from "@/lib/agents/governance/authorization";
import { defaultMemoryService } from "@/lib/agents/memory/service";
import { AgentErrorCodes } from "@/lib/agents/types/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/memories/search
 * Endpoint de prueba e inspección de recuperación semántica (requiere 'memory.read').
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

    // 1. Autorización JIT 'memory.read'
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

    const body = await req.json();
    const { query, limit, similarityThreshold, scopes } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: { code: AgentErrorCodes.INVALID_AGENT_DATA, message: "El parámetro 'query' es requerido.", statusCode: 400 } },
        { status: 400 }
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
      memory_retrieval_mode: "recent",
      memory_max_tokens: 1000,
      memory_similarity_threshold: 0.70,
      memory_scopes: ["agent", "workspace"],
    };

    // 3. Ejecutar recuperación con fallback
    const result = await defaultMemoryService.retrieveMemories(
      {
        query: query.trim(),
        agentId: agent.id,
        userId: user.id,
        limit: limit ? parseInt(limit, 10) : 5,
        similarityThreshold: similarityThreshold ? parseFloat(similarityThreshold) : undefined,
        scopes: scopes || undefined,
      },
      {
        workspaceId: agent.workspace_id,
        userId: user.id,
        policy,
        supabaseClient: supabase,
      }
    );

    return NextResponse.json({
      matches: result.memories,
      count: result.memories.length,
      degraded: result.degraded,
      fallbackReason: result.fallbackReason,
      formattedPromptContext: defaultMemoryService.formatMemoriesForPrompt(result.memories),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: AgentErrorCodes.INTERNAL_AGENT_ERROR, message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
