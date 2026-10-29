import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Genera los últimos N períodos 'YYYY-MM' en orden descendente (incluyendo el actual).
 */
function getRecentPeriods(count: number = 6, now: Date = new Date()): string[] {
  const periods: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;

  for (let i = 0; i < count; i++) {
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return periods;
}

/**
 * GET /api/admin/analytics
 * Agregados centrales de negocio para super_admin (NIV2-4):
 * - revenue_by_client: total pagado y pendiente de client_invoices (por kind), últimos 6 períodos
 * - mrr: suma de suscripciones 'active' agrupada por moneda + conteo de activas
 * - consumption_by_client: tokens (token_usage) últimos 30 días por cliente
 * - health_by_client: % de chequeos 'ok' en site_health_checks por cliente, últimos 7 días
 * - business_metrics_by_client: suma por métrica últimos 30 días
 * - monthly_periods: tabla mensual de los últimos 6 períodos (pagado vs pendiente)
 * Ningún error de una sección tumba las demás (try/catch independiente por sección).
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
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const now = new Date();
    const last6Periods = getRecentPeriods(6, now);
    const thirtyDaysAgoIso = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const thirtyDaysAgoDate = thirtyDaysAgoIso.slice(0, 10);
    const sevenDaysAgoIso = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    // 0. Catálogo base de clientes
    let clientsList: Array<{ id: string; display_name: string; workspace_id?: string | null }> = [];
    try {
      const { data: cData } = await (serviceClient.from("clients") as any)
        .select("id, display_name, workspace_id")
        .order("display_name", { ascending: true });
      if (Array.isArray(cData)) {
        clientsList = cData;
      }
    } catch (cErr) {
      console.error("[ADMIN ANALYTICS] Error cargando clientes:", cErr);
    }

    const clientNameMap = new Map<string, string>();
    const workspaceToClientMap = new Map<string, string>();
    for (const c of clientsList) {
      clientNameMap.set(c.id, c.display_name);
      if (c.workspace_id) {
        workspaceToClientMap.set(c.workspace_id, c.id);
      }
    }

    // 1. SECCIÓN: revenue_by_client + monthly_periods + resumen 30d
    let revenue_by_client: any[] = [];
    let monthly_periods: Array<{
      period: string;
      paid_total: number;
      pending_total: number;
      paid_by_currency: Record<string, number>;
      pending_by_currency: Record<string, number>;
    }> = last6Periods.map((p) => ({
      period: p,
      paid_total: 0,
      pending_total: 0,
      paid_by_currency: {},
      pending_by_currency: {},
    }));
    let paid_last_30d = 0;
    let pending_total_global = 0;

    try {
      const { data: invoices, error: invErr } = await (
        serviceClient.from("client_invoices") as any
      )
        .select(
          "id, client_id, kind, period, amount, currency, status, created_at, updated_at"
        )
        .in("period", last6Periods);

      if (invErr) throw invErr;

      const invRows = Array.isArray(invoices) ? invoices : [];

      const byClientMap = new Map<
        string,
        {
          client_id: string;
          client_name: string;
          paid_total: number;
          pending_total: number;
          by_kind: {
            subscription: { paid: number; pending: number };
            consumption: { paid: number; pending: number };
          };
          periods: Record<string, { paid: number; pending: number }>;
        }
      >();

      for (const c of clientsList) {
        byClientMap.set(c.id, {
          client_id: c.id,
          client_name: c.display_name,
          paid_total: 0,
          pending_total: 0,
          by_kind: {
            subscription: { paid: 0, pending: 0 },
            consumption: { paid: 0, pending: 0 },
          },
          periods: {},
        });
      }

      const periodMap = new Map(monthly_periods.map((mp) => [mp.period, mp]));

      for (const inv of invRows) {
        const amt = Number(inv.amount || 0);
        const curr = String(inv.currency || "USD").toUpperCase();
        const kindKey =
          inv.kind === "subscription" ? "subscription" : "consumption";

        if (!byClientMap.has(inv.client_id)) {
          byClientMap.set(inv.client_id, {
            client_id: inv.client_id,
            client_name:
              clientNameMap.get(inv.client_id) ||
              `Cliente ${String(inv.client_id).slice(0, 8)}`,
            paid_total: 0,
            pending_total: 0,
            by_kind: {
              subscription: { paid: 0, pending: 0 },
              consumption: { paid: 0, pending: 0 },
            },
            periods: {},
          });
        }

        const entry = byClientMap.get(inv.client_id)!;
        if (!entry.periods[inv.period]) {
          entry.periods[inv.period] = { paid: 0, pending: 0 };
        }

        const pSummary = periodMap.get(inv.period);

        if (inv.status === "paid") {
          entry.paid_total = Number((entry.paid_total + amt).toFixed(2));
          entry.by_kind[kindKey].paid = Number(
            (entry.by_kind[kindKey].paid + amt).toFixed(2)
          );
          entry.periods[inv.period].paid = Number(
            (entry.periods[inv.period].paid + amt).toFixed(2)
          );

          if (pSummary) {
            pSummary.paid_total = Number((pSummary.paid_total + amt).toFixed(2));
            pSummary.paid_by_currency[curr] = Number(
              ((pSummary.paid_by_currency[curr] || 0) + amt).toFixed(2)
            );
          }

          const refTimestamp = inv.updated_at || inv.created_at;
          if (refTimestamp && refTimestamp >= thirtyDaysAgoIso) {
            paid_last_30d = Number((paid_last_30d + amt).toFixed(2));
          }
        } else if (inv.status === "pending") {
          entry.pending_total = Number((entry.pending_total + amt).toFixed(2));
          entry.by_kind[kindKey].pending = Number(
            (entry.by_kind[kindKey].pending + amt).toFixed(2)
          );
          entry.periods[inv.period].pending = Number(
            (entry.periods[inv.period].pending + amt).toFixed(2)
          );

          if (pSummary) {
            pSummary.pending_total = Number(
              (pSummary.pending_total + amt).toFixed(2)
            );
            pSummary.pending_by_currency[curr] = Number(
              ((pSummary.pending_by_currency[curr] || 0) + amt).toFixed(2)
            );
          }

          pending_total_global = Number(
            (pending_total_global + amt).toFixed(2)
          );
        }
      }

      revenue_by_client = Array.from(byClientMap.values());
    } catch (revErr) {
      console.error("[ADMIN ANALYTICS] Error en revenue_by_client:", revErr);
    }

    // 2. SECCIÓN: mrr (suma de suscripciones 'active' agrupada por moneda)
    const mrr: Record<string, number> = { USD: 0, DOP: 0 };
    let active_subscriptions_count = 0;

    try {
      const { data: subs, error: subErr } = await (
        serviceClient.from("client_subscriptions") as any
      )
        .select("client_id, amount, currency, status")
        .eq("status", "active");

      if (subErr) throw subErr;

      if (Array.isArray(subs)) {
        active_subscriptions_count = subs.length;
        for (const s of subs) {
          const curr = String(s.currency || "USD").toUpperCase();
          const amt = Number(s.amount || 0);
          mrr[curr] = Number(((mrr[curr] || 0) + amt).toFixed(2));
        }
      }
    } catch (mrrErr) {
      console.error("[ADMIN ANALYTICS] Error en mrr:", mrrErr);
    }

    // 3. SECCIÓN: consumption_by_client (tokens últimos 30 días por cliente)
    let consumption_by_client: Array<{
      client_id: string;
      client_name: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    }> = [];

    try {
      const { data: usageRows, error: uErr } = await (
        serviceClient.from("token_usage") as any
      )
        .select("client_id, workspace_id, input_tokens, output_tokens, created_at")
        .gte("created_at", thirtyDaysAgoIso);

      if (uErr) throw uErr;

      const usageMap = new Map<
        string,
        { input_tokens: number; output_tokens: number; total_tokens: number }
      >();

      for (const c of clientsList) {
        usageMap.set(c.id, {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        });
      }

      for (const row of usageRows || []) {
        const resolvedClientId =
          row.client_id ||
          (row.workspace_id
            ? workspaceToClientMap.get(row.workspace_id)
            : null);

        if (!resolvedClientId) continue;

        if (!usageMap.has(resolvedClientId)) {
          usageMap.set(resolvedClientId, {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
          });
        }

        const entry = usageMap.get(resolvedClientId)!;
        const inp = Number(row.input_tokens || 0);
        const out = Number(row.output_tokens || 0);
        entry.input_tokens += inp;
        entry.output_tokens += out;
        entry.total_tokens += inp + out;
      }

      consumption_by_client = Array.from(usageMap.entries()).map(
        ([cid, totals]) => ({
          client_id: cid,
          client_name:
            clientNameMap.get(cid) || `Cliente ${String(cid).slice(0, 8)}`,
          ...totals,
        })
      );
    } catch (consErr) {
      console.error(
        "[ADMIN ANALYTICS] Error en consumption_by_client:",
        consErr
      );
    }

    // 4. SECCIÓN: health_by_client (% de chequeos 'ok' en site_health_checks, últimos 7 días)
    let health_by_client: Array<{
      client_id: string;
      client_name: string;
      ok_checks: number;
      total_checks: number;
      uptime_pct: number | null;
    }> = [];

    try {
      // Paginación obligatoria: PostgREST devuelve 1000 filas por defecto y
      // Conteo en BD en vez de traer las filas: los chequeos son por minuto
      // (~17k en 7 días) y paginarlos en serie costaba ~10 s en la página.
      // Dos conteos por cliente (total y ok) en paralelo dan el mismo
      // resultado que el agregado anterior, sin mover filas.
      const healthMap = new Map<string, { ok: number; total: number }>();
      const healthCounts = await Promise.all(
        clientsList.map(async (c) => {
          const [totalRes, okRes] = await Promise.all([
            (serviceClient.from("site_health_checks") as any)
              .select("id", { count: "exact", head: true })
              .eq("client_id", c.id)
              .gte("checked_at", sevenDaysAgoIso),
            (serviceClient.from("site_health_checks") as any)
              .select("id", { count: "exact", head: true })
              .eq("client_id", c.id)
              .eq("status", "ok")
              .gte("checked_at", sevenDaysAgoIso),
          ]);
          if (totalRes.error || okRes.error) {
            throw totalRes.error || okRes.error;
          }
          return { id: c.id, ok: okRes.count || 0, total: totalRes.count || 0 };
        })
      );
      for (const h of healthCounts) {
        healthMap.set(h.id, { ok: h.ok, total: h.total });
      }

      health_by_client = Array.from(healthMap.entries()).map(
        ([cid, counts]) => ({
          client_id: cid,
          client_name:
            clientNameMap.get(cid) || `Cliente ${String(cid).slice(0, 8)}`,
          ok_checks: counts.ok,
          total_checks: counts.total,
          uptime_pct:
            counts.total > 0
              ? Number(((counts.ok / counts.total) * 100).toFixed(2))
              : null,
        })
      );
    } catch (healthErr) {
      console.error("[ADMIN ANALYTICS] Error en health_by_client:", healthErr);
    }

    // 5. SECCIÓN: business_metrics_by_client (suma por métrica últimos 30 días)
    let business_metrics_by_client: Array<{
      client_id: string;
      client_name: string;
      metrics: {
        visits: number;
        sales: number;
        orders: number;
        revenue: number;
      };
      reported: {
        visits: boolean;
        sales: boolean;
        orders: boolean;
        revenue: boolean;
      };
      currency: string | null;
      has_data: boolean;
    }> = [];

    try {
      const { data: metricRows, error: mErr } = await (
        serviceClient.from("business_metrics") as any
      )
        .select("client_id, metric, value, currency, metric_date")
        .gte("metric_date", thirtyDaysAgoDate);

      if (mErr) throw mErr;

      const metricsMap = new Map<
        string,
        {
          visits: number;
          sales: number;
          orders: number;
          revenue: number;
          reported: {
            visits: boolean;
            sales: boolean;
            orders: boolean;
            revenue: boolean;
          };
          currency: string | null;
          has_data: boolean;
        }
      >();

      const emptyEntry = () => ({
        visits: 0,
        sales: 0,
        orders: 0,
        revenue: 0,
        reported: { visits: false, sales: false, orders: false, revenue: false },
        currency: null as string | null,
        has_data: false,
      });

      for (const c of clientsList) {
        metricsMap.set(c.id, emptyEntry());
      }

      for (const row of metricRows || []) {
        if (!row.client_id) continue;
        if (!metricsMap.has(row.client_id)) {
          metricsMap.set(row.client_id, emptyEntry());
        }
        const entry = metricsMap.get(row.client_id)!;
        const val = Number(row.value || 0);
        if (
          row.metric === "visits" ||
          row.metric === "sales" ||
          row.metric === "orders" ||
          row.metric === "revenue"
        ) {
          entry[row.metric as "visits" | "sales" | "orders" | "revenue"] =
            Number(
              (
                entry[row.metric as "visits" | "sales" | "orders" | "revenue"] +
                val
              ).toFixed(2)
            );
          entry.reported[row.metric as "visits" | "sales" | "orders" | "revenue"] = true;
          entry.has_data = true;
        }
        if (row.currency && !entry.currency) {
          entry.currency = row.currency;
        }
      }

      business_metrics_by_client = Array.from(metricsMap.entries()).map(
        ([cid, data]) => ({
          client_id: cid,
          client_name:
            clientNameMap.get(cid) || `Cliente ${String(cid).slice(0, 8)}`,
          metrics: {
            visits: data.visits,
            sales: data.sales,
            orders: data.orders,
            revenue: data.revenue,
          },
          reported: data.reported,
          currency: data.currency,
          has_data: data.has_data,
        })
      );
    } catch (bmErr) {
      console.error(
        "[ADMIN ANALYTICS] Error en business_metrics_by_client:",
        bmErr
      );
    }

    return NextResponse.json({
      summary: {
        paid_last_30d,
        pending_total: pending_total_global,
        mrr,
        active_subscriptions_count,
      },
      revenue_by_client,
      mrr,
      consumption_by_client,
      health_by_client,
      business_metrics_by_client,
      monthly_periods,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR", message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
