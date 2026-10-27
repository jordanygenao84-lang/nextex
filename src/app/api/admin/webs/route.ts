import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/webs
 * Lista de webs (clientes) con resumen por web: salud, dominios, backups,
 * tickets abiertos, llaves de sitio activas y última actividad.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores.
 * No expone valores de llaves ni secretos, solo contadores y estados.
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

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: clients, error: clientsErr } = await (serviceClient.from("clients") as any)
      .select(
        "id, display_name, website_url, status, contact_name, contact_email, contact_phone, notes, created_at, updated_at"
      )
      .order("display_name", { ascending: true });

    if (clientsErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: clientsErr.message } },
        { status: 500 }
      );
    }

    const dnsRank: Record<string, number> = {
      expired: 4,
      expiring: 3,
      dns_issue: 2,
      unknown: 1,
      ok: 0,
    };

    const webs = await Promise.all(
      (clients || []).map(async (c: any) => {
        const [domainsRes, backupCfgRes, backupRunRes, ticketsRes, healthRes, keysRes] =
          await Promise.all([
            (serviceClient.from("domains") as any)
              .select("id, dns_status")
              .eq("client_id", c.id),
            (serviceClient.from("backup_configs") as any)
              .select("enabled")
              .eq("client_id", c.id)
              .maybeSingle(),
            (serviceClient.from("backup_runs") as any)
              .select("id, status, size_bytes, created_at")
              .eq("client_id", c.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            (serviceClient.from("support_tickets") as any)
              .select("id, status, updated_at")
              .eq("client_id", c.id),
            (serviceClient.from("site_health_checks") as any)
              .select("status, response_ms, checked_at")
              .eq("client_id", c.id)
              .order("checked_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            (serviceClient.from("client_site_keys") as any)
              .select("id")
              .eq("client_id", c.id)
              .eq("is_active", true),
          ]);

        const domains = domainsRes.data || [];
        const dnsWorst = domains.reduce(
          (worst: string, d: any) =>
            (dnsRank[d.dns_status] ?? 0) > (dnsRank[worst] ?? 0) ? d.dns_status : worst,
          domains.length > 0 ? "ok" : "none"
        );

        const backupCfg = backupCfgRes.data || null;
        const lastBackup = backupRunRes.data || null;
        let backupStatus = "sin_configurar";
        if (backupCfg) {
          if (!backupCfg.enabled) {
            backupStatus = "pausado";
          } else if (!lastBackup) {
            backupStatus = "sin_corridas";
          } else if (lastBackup.status === "ok") {
            const ageDays =
              (Date.now() - new Date(lastBackup.created_at).getTime()) / 86400000;
            backupStatus = ageDays <= 8 ? "al_dia" : "atrasado";
          } else {
            backupStatus = "fallo";
          }
        }

        const tickets = ticketsRes.data || [];
        const openTickets = tickets.filter((t: any) => t.status !== "closed").length;

        const lastHealth = healthRes.data || null;
        const lastTicketAt = tickets.reduce(
          (max: string | null, t: any) =>
            !max || new Date(t.updated_at).getTime() > new Date(max).getTime()
              ? t.updated_at
              : max,
          null as string | null
        );
        const lastActivity = [lastHealth?.checked_at, lastBackup?.created_at, lastTicketAt]
          .filter(Boolean)
          .sort()
          .pop() || null;

        return {
          id: c.id,
          display_name: c.display_name,
          website_url: c.website_url,
          status: c.status,
          contact_name: c.contact_name,
          contact_email: c.contact_email,
          contact_phone: c.contact_phone,
          notes: c.notes,
          created_at: c.created_at,
          updated_at: c.updated_at,
          summary: {
            health_status: lastHealth?.status || "sin_datos",
            health_response_ms: lastHealth?.response_ms ?? null,
            health_checked_at: lastHealth?.checked_at || null,
            domains_count: domains.length,
            dns_worst: dnsWorst,
            backup_status: backupStatus,
            backup_last_at: lastBackup?.created_at || null,
            backup_last_size_bytes: lastBackup?.size_bytes ?? null,
            open_tickets: openTickets,
            tickets_total: tickets.length,
            active_keys: (keysRes.data || []).length,
            last_activity_at: lastActivity,
          },
        };
      })
    );

    return NextResponse.json({ webs, total: webs.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar webs." } },
      { status: 500 }
    );
  }
}
