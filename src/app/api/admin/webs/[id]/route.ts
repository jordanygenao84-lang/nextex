import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/webs/[id]
 * Ficha completa de una web: datos, dominios, backups, llaves de sitio
 * (solo prefijo y estado, nunca el valor), tickets y último reporte de
 * cada API de seguimiento (salud, eventos VIGÍA, errores, métricas).
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: web, error: webErr } = await (serviceClient.from("clients") as any)
      .select(
        "id, display_name, website_url, status, contact_name, contact_email, contact_phone, notes, created_at, updated_at"
      )
      .eq("id", params.id)
      .maybeSingle();

    if (webErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (!web) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Web no encontrada." } },
        { status: 404 }
      );
    }

    const [
      domainsRes,
      backupCfgRes,
      backupRunsRes,
      keysRes,
      ticketsRes,
      healthRes,
      vigiaRes,
      errorsRes,
      metricsRes,
    ] = await Promise.all([
      (serviceClient.from("domains") as any)
        .select(
          "id, domain, provider, registrar, expires_at, auto_renew, expected_target, dns_status, dns_checked_at, notes, created_at"
        )
        .eq("client_id", params.id)
        .order("domain", { ascending: true }),
      (serviceClient.from("backup_configs") as any)
        .select("client_id, supabase_url, github_repo, github_branch, enabled, created_at, updated_at")
        .eq("client_id", params.id)
        .maybeSingle(),
      (serviceClient.from("backup_runs") as any)
        .select("id, kind, status, location, size_bytes, detail, created_at")
        .eq("client_id", params.id)
        .order("created_at", { ascending: false })
        .limit(10),
      (serviceClient.from("client_site_keys") as any)
        .select("id, name, key_prefix, is_active, last_used_at, created_at")
        .eq("client_id", params.id)
        .order("created_at", { ascending: false }),
      (serviceClient.from("support_tickets") as any)
        .select("id, subject, status, priority, created_at, updated_at")
        .eq("client_id", params.id)
        .order("updated_at", { ascending: false })
        .limit(10),
      (serviceClient.from("site_health_checks") as any)
        .select("status, response_ms, ssl_days_left, checked_at")
        .eq("client_id", params.id)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (serviceClient.from("security_events") as any)
        .select("event_type, created_at")
        .eq("client_id", params.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (serviceClient.from("error_events") as any)
        .select("fingerprint, last_seen_at")
        .eq("client_id", params.id)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (serviceClient.from("business_metrics") as any)
        .select("metric, metric_date, created_at")
        .eq("client_id", params.id)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const tickets = ticketsRes.data || [];
    const openTickets = tickets.filter((t: any) => t.status !== "closed").length;

    return NextResponse.json({
      web,
      domains: domainsRes.data || [],
      backup: {
        config: backupCfgRes.data || null,
        runs: backupRunsRes.data || [],
      },
      site_keys: keysRes.data || [],
      tickets: {
        open: openTickets,
        recent: tickets,
      },
      tracking: {
        health: healthRes.data || null,
        vigia_event: vigiaRes.data || null,
        error: errorsRes.data || null,
        metric: metricsRes.data || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
