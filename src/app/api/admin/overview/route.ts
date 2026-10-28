import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/overview
 * Retorna las métricas globales consolidadas para el panel de administración.
 * ACCESO RESTRINGIDO: Exclusivo para usuarios con rol super_admin (403 si no lo es).
 */
export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    // 1. Verificación de superadministrador
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const now = new Date();
    const startOfTodayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // 2. Consultas en paralelo para optimizar tiempo de respuesta
    const [
      clientsRes,
      conversationsRes,
      tokenUsageRes,
      cacheRes,
      invoicesRes,
      recentConvsRes,
    ] = await Promise.all([
      // a. Clientes
      (serviceClient.from("clients") as any).select("id, status"),

      // b. Conversaciones totales para cálculo de hoy y por estado
      (serviceClient.from("conversations") as any).select("id, status, last_message_at"),

      // c. Consumo de tokens del mes actual
      (serviceClient.from("token_usage") as any)
        .select("input_tokens, output_tokens")
        .gte("created_at", startOfMonthIso),

      // d. Caché de respuestas
      (serviceClient.from("response_cache") as any).select("hit_count"),

      // e. Facturas
      (serviceClient.from("client_invoices") as any).select("amount, status"),

      // f. Últimas 5 conversaciones recientes
      (serviceClient.from("conversations") as any)
        .select(`
          id,
          channel,
          visitor_name,
          last_message_at,
          client:clients (
            id,
            display_name
          )
        `)
        .order("last_message_at", { ascending: false })
        .limit(5),
    ]);

    // 3. Procesar Clientes
    const clients = clientsRes.data || [];
    const total_clients = clients.length;
    const active_clients = clients.filter((c: any) => c.status === "active").length;

    // 4. Procesar Conversaciones
    const allConvs = conversationsRes.data || [];
    let conversations_today = 0;
    const conversations_by_status = { bot: 0, human: 0, paused: 0 };

    for (const conv of allConvs) {
      if (conv.last_message_at && conv.last_message_at >= startOfTodayIso) {
        conversations_today++;
      }
      if (conv.status === "bot") conversations_by_status.bot++;
      else if (conv.status === "human") conversations_by_status.human++;
      else if (conv.status === "paused") conversations_by_status.paused++;
    }

    // 5. Procesar Tokens este mes
    const usageRows = tokenUsageRes.data || [];
    let tokens_this_month = 0;
    for (const row of usageRows) {
      tokens_this_month += (row.input_tokens || 0) + (row.output_tokens || 0);
    }

    // 6. Procesar Cache Hit Rate (sum(hit_count) / (sum(hit_count) + count))
    const cacheRows = cacheRes.data || [];
    let sumHitCount = 0;
    const cacheCount = cacheRows.length;
    for (const row of cacheRows) {
      sumHitCount += Number(row.hit_count || 0);
    }
    const totalCacheQueries = sumHitCount + cacheCount;
    const cache_hit_rate =
      totalCacheQueries > 0 ? Number((sumHitCount / totalCacheQueries).toFixed(4)) : 0;

    // 7. Procesar Facturas pendientes
    const invoices = invoicesRes.data || [];
    let pending_invoices_count = 0;
    let pending_invoices_amount = 0;
    for (const inv of invoices) {
      if (inv.status === "pending") {
        pending_invoices_count++;
        pending_invoices_amount += Number(inv.amount || 0);
      }
    }
    pending_invoices_amount = Number(pending_invoices_amount.toFixed(2));

    // 8. Procesar Últimas 5 Conversaciones
    const recentConvs = recentConvsRes.data || [];
    const recent_conversations = recentConvs.map((c: any) => ({
      id: c.id,
      client_name: c.client?.display_name || "Cliente",
      channel: c.channel,
      visitor_name: c.visitor_name || "Visitante",
      last_message_at: c.last_message_at,
    }));

    return NextResponse.json({
      total_clients,
      active_clients,
      conversations_today,
      conversations_by_status,
      tokens_this_month,
      cache_hit_rate,
      pending_invoices_count,
      pending_invoices_amount,
      recent_conversations,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
