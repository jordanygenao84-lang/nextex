import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { calculateTraceTiming } from "@/lib/observability/timing";
import { ObservabilitySpan, TraceSummary } from "@/lib/observability/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/observability/traces
 * Lista trazas de observabilidad para el workspace autenticado.
 * RLS y comprobación de permisos estricta ("runs.read").
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: { code: "WORKSPACE_REQUIRED", message: "workspaceId es obligatorio.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const authCheck = await defaultPermissionEngine.can(user.id, workspaceId, "runs.read", {
      supabaseClient: supabase,
    });
    if (!authCheck.allowed) {
      return NextResponse.json(
        { error: { code: "PERMISSION_DENIED", message: authCheck.reason, statusCode: 403 } },
        { status: 403 }
      );
    }

    const status = searchParams.get("status");
    const component = searchParams.get("component");
    const spanType = searchParams.get("spanType");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

    // Consulta con RLS activo sobre observability_spans
    let query = (supabase.from("observability_spans") as any)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }
    if (component) {
      query = query.eq("component", component);
    }
    if (spanType) {
      query = query.eq("span_type", spanType);
    }

    const { data: spans, error } = await query.range(offset, offset + limit * 5);

    if (error) {
      throw error;
    }

    // Agrupar spans por trace_id
    const traceMap = new Map<string, ObservabilitySpan[]>();
    for (const span of (spans || []) as ObservabilitySpan[]) {
      const list = traceMap.get(span.trace_id) || [];
      list.push(span);
      traceMap.set(span.trace_id, list);
    }

    const traces: TraceSummary[] = [];
    const entries = Array.from(traceMap.entries());

    for (const [traceId, traceSpans] of entries) {
      if (traces.length >= limit) break;

      // El root span es aquel sin parent_span_id, o el primero por started_at
      const rootSpan =
        traceSpans.find((s: ObservabilitySpan) => !s.parent_span_id) ||
        [...traceSpans].sort(
          (a: ObservabilitySpan, b: ObservabilitySpan) =>
            new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
        )[0];

      const timing = calculateTraceTiming(traceSpans);
      const hasErrors = traceSpans.some((s: ObservabilitySpan) => s.status === "failed");
      const errorCount = traceSpans.filter((s: ObservabilitySpan) => s.status === "failed").length;
      const components = Array.from(
        new Set(traceSpans.map((s: ObservabilitySpan) => s.component))
      ) as string[];

      const sorted = [...traceSpans].sort(
        (a: ObservabilitySpan, b: ObservabilitySpan) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      traces.push({
        traceId,
        workspaceId,
        rootSpan,
        spansCount: traceSpans.length,
        status: hasErrors ? "failed" : rootSpan?.status || "completed",
        startedAt: first?.started_at || new Date().toISOString(),
        completedAt: last?.completed_at || null,
        timing,
        hasErrors,
        errorCount,
        components,
      });
    }

    return NextResponse.json({ traces });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al consultar trazas", statusCode: 500 } },
      { status: 500 }
    );
  }
}
