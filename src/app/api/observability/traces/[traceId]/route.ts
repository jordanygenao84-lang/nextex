import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { calculateTraceTiming } from "@/lib/observability/timing";
import { ObservabilitySpan } from "@/lib/observability/types";

export const dynamic = "force-dynamic";

export interface SpanTreeNode {
  span: ObservabilitySpan;
  children: SpanTreeNode[];
}

/**
 * Reconstruye el árbol causal jerárquico a partir de la lista plana de spans.
 */
function buildSpanTree(spans: ObservabilitySpan[]): SpanTreeNode[] {
  const nodeMap = new Map<string, SpanTreeNode>();
  const rootNodes: SpanTreeNode[] = [];

  for (const span of spans) {
    nodeMap.set(span.span_id, { span, children: [] });
  }

  for (const span of spans) {
    const node = nodeMap.get(span.span_id)!;
    if (span.parent_span_id && nodeMap.has(span.parent_span_id)) {
      nodeMap.get(span.parent_span_id)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  return rootNodes;
}

/**
 * GET /api/observability/traces/[traceId]
 * Obtiene el detalle completo y árbol jerárquico de una traza.
 * Protegido por RLS y pertenencia a Workspace.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { traceId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const { traceId } = params;
    if (!traceId) {
      return NextResponse.json(
        { error: { code: "INVALID_TRACE_ID", message: "traceId es requerido.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    // Consulta con RLS activo: solo recuperará filas si el usuario pertenece al workspace
    let query = (supabase.from("observability_spans") as any)
      .select("*")
      .eq("trace_id", traceId)
      .order("started_at", { ascending: true });

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data: spans, error } = await query;

    if (error) {
      throw error;
    }

    if (!spans || spans.length === 0) {
      return NextResponse.json(
        { error: { code: "TRACE_NOT_FOUND", message: "Traza no encontrada o sin autorización.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const typedSpans = spans as ObservabilitySpan[];
    const resolvedWorkspaceId = typedSpans[0].workspace_id;

    // Doble verificación de permisos a nivel aplicación
    const authCheck = await defaultPermissionEngine.can(user.id, resolvedWorkspaceId, "runs.read", {
      supabaseClient: supabase,
    });
    if (!authCheck.allowed) {
      return NextResponse.json(
        { error: { code: "PERMISSION_DENIED", message: authCheck.reason, statusCode: 403 } },
        { status: 403 }
      );
    }

    const timing = calculateTraceTiming(typedSpans);
    const tree = buildSpanTree(typedSpans);

    return NextResponse.json({
      traceId,
      workspaceId: resolvedWorkspaceId,
      spansCount: typedSpans.length,
      timing,
      tree,
      spans: typedSpans,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al recuperar traza", statusCode: 500 } },
      { status: 500 }
    );
  }
}
