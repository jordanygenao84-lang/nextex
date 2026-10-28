import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkMonthlyBudget } from "@/lib/efficiency/usage";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/consumption
 * Devuelve métricas de consumo de tokens, distribución por modelo y por día,
 * estadísticas de caché y estado del presupuesto mensual del cliente (con auth).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const clientId = params.id;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();
    const workspaceId = client.workspace_id;

    // 2. Definir ventana de tiempo para el mes en curso (YYYY-MM)
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = String(now.getMonth() + 1).padStart(2, "0");
    const monthStr = `${year}-${monthNum}`;
    const startOfMonth = new Date(year, now.getMonth(), 1).toISOString();

    // 3. Consultar consumo de tokens en el mes
    const { data: usageRows, error: usageErr } = await (serviceClient.from("token_usage") as any)
      .select("model, input_tokens, output_tokens, created_at")
      .eq("client_id", clientId)
      .gte("created_at", startOfMonth)
      .order("created_at", { ascending: true });

    if (usageErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: usageErr.message } },
        { status: 500 }
      );
    }

    const rows = Array.isArray(usageRows) ? usageRows : [];

    let totalTokens = 0;
    const modelMap: Record<string, number> = {};
    const dayMap: Record<string, number> = {};

    for (const row of rows) {
      const tokens = (row.input_tokens || 0) + (row.output_tokens || 0);
      totalTokens += tokens;

      // Desglose por modelo
      const modelName = row.model || "gemini-1.5-flash";
      modelMap[modelName] = (modelMap[modelName] || 0) + tokens;

      // Desglose por día (YYYY-MM-DD)
      const dayStr = row.created_at ? row.created_at.slice(0, 10) : monthStr + "-01";
      dayMap[dayStr] = (dayMap[dayStr] || 0) + tokens;
    }

    const byModel = Object.entries(modelMap).map(([model, tokens]) => ({
      model,
      tokens,
    }));

    const byDay = Object.entries(dayMap).map(([day, tokens]) => ({
      day,
      tokens,
    }));

    // 4. Consultar estadísticas de response_cache del workspace
    let cacheHits = 0;
    if (workspaceId) {
      const { data: cacheRecords } = await (serviceClient.from("response_cache") as any)
        .select("hit_count")
        .eq("workspace_id", workspaceId);

      if (Array.isArray(cacheRecords)) {
        for (const c of cacheRecords) {
          const hits = Number(c.hit_count) || 1;
          if (hits > 1) {
            cacheHits += hits - 1;
          }
        }
      }
    }

    const totalRequests = rows.length + cacheHits;
    const cacheHitRate =
      totalRequests > 0 ? Number((cacheHits / totalRequests).toFixed(4)) : 0;

    // 5. Presupuesto mensual
    const budget = await checkMonthlyBudget(clientId);

    return NextResponse.json({
      month: monthStr,
      total_tokens: totalTokens,
      by_model: byModel,
      by_day: byDay,
      cache_hits: cacheHits,
      cache_hit_rate: cacheHitRate,
      budget,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
