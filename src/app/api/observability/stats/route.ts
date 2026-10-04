import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { MetricsCollector } from "@/lib/observability/metrics";
import { ObservabilitySpan } from "@/lib/observability/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/observability/stats
 * Devuelve métricas consolidadas del workspace para las KPI cards del Dashboard.
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

    // Consultar últimos 500 spans del workspace para estadísticas operacionales
    const { data: spans, error } = await (supabase.from("observability_spans") as any)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(500);

    if (error) {
      throw error;
    }

    const typedSpans = (spans || []) as ObservabilitySpan[];
    const aggregates = MetricsCollector.calculateAggregates(typedSpans);

    // Conteo de trazas únicas
    const uniqueTraces = new Set(typedSpans.map((s) => s.trace_id));

    return NextResponse.json({
      workspaceId,
      totalUniqueTraces: uniqueTraces.size,
      ...aggregates,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al calcular estadísticas", statusCode: 500 } },
      { status: 500 }
    );
  }
}
