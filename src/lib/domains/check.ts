import { promises as dns } from "dns";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendVigiaAlert } from "@/lib/vigia/notify";
import { calculateDaysLeft } from "@/lib/protection/credentials";

export type DomainDnsStatus =
  | "ok"
  | "dns_issue"
  | "expiring"
  | "expired"
  | "unknown";

export interface DomainRecord {
  id: string;
  client_id?: string | null;
  domain: string;
  provider?: string | null;
  registrar?: string | null;
  expires_at?: string | null;
  auto_renew: boolean;
  expected_target?: string | null;
  dns_status: DomainDnsStatus;
  dns_checked_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  days_left?: number | null;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

export interface DomainCheckResult {
  id: string;
  domain: string;
  dns_status: DomainDnsStatus;
  dns_checked_at: string;
  resolved: boolean;
  target_matched: boolean;
  records: {
    a: string[];
    aaaa: string[];
    cname: string[];
  };
  days_left: number | null;
  error?: string;
}

/**
 * Normaliza un nombre de dominio quitando protocolo, ruta y puntos finales.
 */
export function normalizeDomainName(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

/**
 * Determina el estado inicial o derivado de vencimiento cuando existe expires_at.
 * - daysLeft < 0 -> 'expired'
 * - 0 <= daysLeft <= 30 -> 'expiring'
 * - > 30 o sin fecha -> null (prevalece el resultado DNS)
 */
export function computeExpirationOverrideStatus(
  expiresAt?: string | null
): "expired" | "expiring" | null {
  const daysLeft = calculateDaysLeft(expiresAt);
  if (daysLeft === null) return null;
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return null;
}

/**
 * Resuelve registros A, AAAA y CNAME de un dominio con dns.promises.
 * Si resuelve (y coincide con expected_target cuando está configurado) -> 'ok'
 * (o 'expiring' / 'expired' si expires_at <= hoy + 30 días).
 * Si falla la resolución (y no está en 'expired' / 'expiring') -> 'dns_issue'.
 * Actualiza dns_status y dns_checked_at en la tabla domains.
 * Nunca lanza excepción.
 */
export async function checkDomain(
  supabaseClient: SupabaseClient | any,
  domainRow: {
    id: string;
    domain: string;
    expected_target?: string | null;
    expires_at?: string | null;
  }
): Promise<DomainCheckResult> {
  const nowIso = new Date().toISOString();
  const cleanDomain = normalizeDomainName(domainRow.domain);
  const daysLeft = calculateDaysLeft(domainRow.expires_at);
  const expirationStatus = computeExpirationOverrideStatus(domainRow.expires_at);

  const records: { a: string[]; aaaa: string[]; cname: string[] } = {
    a: [],
    aaaa: [],
    cname: [],
  };

  let resolved = false;
  let targetMatched = true;
  let dnsError: string | undefined;

  try {
    const [aRes, aaaaRes, cnameRes] = await Promise.allSettled([
      dns.resolve4(cleanDomain),
      dns.resolve6(cleanDomain),
      dns.resolveCname(cleanDomain),
    ]);

    if (aRes.status === "fulfilled" && Array.isArray(aRes.value)) {
      records.a = aRes.value;
    }
    if (aaaaRes.status === "fulfilled" && Array.isArray(aaaaRes.value)) {
      records.aaaa = aaaaRes.value;
    }
    if (cnameRes.status === "fulfilled" && Array.isArray(cnameRes.value)) {
      records.cname = cnameRes.value;
    }

    // Fallback a dns.lookup si resolve4/6/Cname no devolvieron registros directos (ej. CNAME encadenado en algunos resolvers)
    if (
      records.a.length === 0 &&
      records.aaaa.length === 0 &&
      records.cname.length === 0
    ) {
      try {
        const lookupRes = await dns.lookup(cleanDomain, { all: true });
        for (const item of lookupRes) {
          if (item.family === 4) records.a.push(item.address);
          else if (item.family === 6) records.aaaa.push(item.address);
        }
      } catch (lookupErr: any) {
        dnsError = lookupErr?.code || lookupErr?.message || "ENOTFOUND";
      }
    }

    resolved =
      records.a.length > 0 ||
      records.aaaa.length > 0 ||
      records.cname.length > 0;

    if (
      resolved &&
      domainRow.expected_target &&
      String(domainRow.expected_target).trim() !== ""
    ) {
      const expectedClean = normalizeDomainName(domainRow.expected_target);
      const allTargets = [
        ...records.a,
        ...records.aaaa,
        ...records.cname,
      ].map((t) => normalizeDomainName(t));

      targetMatched = allTargets.some(
        (t) =>
          t === expectedClean ||
          t.endsWith(`.${expectedClean}`) ||
          expectedClean.endsWith(`.${t}`)
      );
    }
  } catch (err: any) {
    dnsError = err?.message || "Error resolviendo DNS";
    resolved = false;
  }

  let finalStatus: DomainDnsStatus;
  if (expirationStatus === "expired") {
    finalStatus = "expired";
  } else if (expirationStatus === "expiring") {
    finalStatus = "expiring";
  } else if (resolved && targetMatched) {
    finalStatus = "ok";
  } else {
    finalStatus = "dns_issue";
  }

  try {
    let client = supabaseClient;
    if (!client) {
      const { createServiceClient } = await import("@/lib/supabase/server");
      client = createServiceClient();
    }

    await (client.from("domains") as any)
      .update({
        dns_status: finalStatus,
        dns_checked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", domainRow.id);
  } catch (dbErr) {
    console.error(
      `[DOMAINS] Error actualizando dns_status para ${cleanDomain}:`,
      dbErr
    );
  }

  return {
    id: domainRow.id,
    domain: cleanDomain,
    dns_status: finalStatus,
    dns_checked_at: nowIso,
    resolved,
    target_matched: targetMatched,
    records,
    days_left: daysLeft,
    ...(dnsError ? { error: dnsError } : {}),
  };
}

export interface CheckDomainExpirationsResult {
  checked: number;
  alerted: number;
  skipped: number;
  details: Array<{
    id: string;
    domain: string;
    expires_at: string;
    days_left: number;
    status: "expiring" | "expired";
    alerted: boolean;
    reason?: string;
  }>;
}

/**
 * Evalúa todos los dominios con expires_at <= hoy + 30 días.
 * Actualiza dns_status a 'expiring' o 'expired' según corresponda.
 * Si no existe incident_log kind='domain_alert' con detail->>'domain' = dominio y detail->>'expires_at' = su fecha:
 *   - Dispara alerta por Telegram (sendVigiaAlert)
 *   - Registra el incident_log (y si Telegram aún no está configurado en el entorno, registra igualmente el incidente
 *     de alerta de dominio para dejar evidencia auditada y evitar duplicados).
 * Nunca lanza excepción.
 */
export async function checkDomainExpirations(
  supabaseClient?: SupabaseClient | any
): Promise<CheckDomainExpirationsResult> {
  const result: CheckDomainExpirationsResult = {
    checked: 0,
    alerted: 0,
    skipped: 0,
    details: [],
  };

  try {
    let client = supabaseClient;
    if (!client) {
      const { createServiceClient } = await import("@/lib/supabase/server");
      client = createServiceClient();
    }

    const { data: domains, error: domErr } = await (
      client.from("domains") as any
    )
      .select("*")
      .not("expires_at", "is", null);

    if (domErr) {
      console.error("[DOMAINS] Error consultando domains:", domErr);
      return result;
    }

    if (!Array.isArray(domains) || domains.length === 0) {
      return result;
    }

    result.checked = domains.length;

    const { data: existingIncidents, error: incErr } = await (
      client.from("incident_log") as any
    )
      .select("id, detail")
      .eq("kind", "domain_alert");

    if (incErr) {
      console.warn("[DOMAINS] Error consultando incident_log:", incErr);
    }

    const pastAlerts = Array.isArray(existingIncidents)
      ? existingIncidents
      : [];

    for (const dom of domains) {
      const daysLeft = calculateDaysLeft(dom.expires_at);
      if (daysLeft === null || daysLeft > 30) {
        continue;
      }

      const targetStatus: "expired" | "expiring" =
        daysLeft < 0 ? "expired" : "expiring";

      if (dom.dns_status !== targetStatus) {
        try {
          await (client.from("domains") as any)
            .update({
              dns_status: targetStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dom.id);
        } catch (uErr) {
          console.warn(
            `[DOMAINS] Error sincronizando estado ${targetStatus} en ${dom.domain}:`,
            uErr
          );
        }
      }

      const alreadyAlerted = pastAlerts.some((row: any) => {
        const d = row?.detail;
        if (!d) return false;
        return (
          String(d.domain) === String(dom.domain) &&
          String(d.expires_at) === String(dom.expires_at)
        );
      });

      if (alreadyAlerted) {
        result.skipped++;
        result.details.push({
          id: dom.id,
          domain: dom.domain,
          expires_at: dom.expires_at,
          days_left: daysLeft,
          status: targetStatus,
          alerted: false,
          reason: "Alerta ya registrada para este dominio y fecha de vencimiento",
        });
        continue;
      }

      const isExpired = daysLeft < 0;
      const title = isExpired
        ? `🚨 Dominio VENCIDO — ${dom.domain}, venció ${dom.expires_at}`
        : `🌐 Dominio por vencer — ${dom.domain}, vence ${dom.expires_at}`;

      const bodyLines = [
        `Dominio: ${dom.domain}`,
        `Vencimiento: ${dom.expires_at} (${
          isExpired
            ? `vencido hace ${Math.abs(daysLeft)} días`
            : `vence en ${daysLeft} días`
        })`,
      ];
      if (dom.registrar) bodyLines.push(`Registrador: ${dom.registrar}`);
      if (dom.provider) bodyLines.push(`Proveedor DNS: ${dom.provider}`);

      const sent = await sendVigiaAlert(title, bodyLines.join("\n"), {
        force: true,
      });

      const hasTelegramEnv = Boolean(
        process.env.TELEGRAM_BOT_TOKEN?.trim() &&
          process.env.TELEGRAM_CHAT_ID?.trim()
      );

      // Si se envió por Telegram (o si Telegram aún no está configurado en el entorno),
      // registramos el incident_log kind='domain_alert' para cumplir auditoría y deduplicación.
      if (sent || !hasTelegramEnv) {
        try {
          const detailPayload = {
            domain_id: dom.id,
            domain: dom.domain,
            expires_at: dom.expires_at,
            days_left: daysLeft,
            status: targetStatus,
            registrar: dom.registrar || null,
            provider: dom.provider || null,
            alerted: sent,
            channel: "telegram",
            sent_at: new Date().toISOString(),
          };

          await (client.from("incident_log") as any).insert({
            client_id: dom.client_id || null,
            kind: "domain_alert",
            title,
            detail: detailPayload,
          });

          pastAlerts.push({ detail: detailPayload });
          result.alerted++;
          result.details.push({
            id: dom.id,
            domain: dom.domain,
            expires_at: dom.expires_at,
            days_left: daysLeft,
            status: targetStatus,
            alerted: true,
          });
        } catch (logInsertErr) {
          console.error(
            "[DOMAINS] Error insertando incident_log kind='domain_alert':",
            logInsertErr
          );
        }
      } else {
        result.skipped++;
        result.details.push({
          id: dom.id,
          domain: dom.domain,
          expires_at: dom.expires_at,
          days_left: daysLeft,
          status: targetStatus,
          alerted: false,
          reason: "Fallo temporal en envío a Telegram",
        });
      }
    }
  } catch (err) {
    console.error("[DOMAINS] Excepción en checkDomainExpirations:", err);
  }

  return result;
}

export interface ExecuteDomainChecksResult {
  total_domains: number;
  dns_checked: number;
  dns_skipped_24h: number;
  expirations: CheckDomainExpirationsResult;
}

/**
 * Recorre todos los dominios, ejecuta checkDomain con puerta de 24h según dns_checked_at,
 * y luego ejecuta checkDomainExpirations.
 * Nunca lanza excepción.
 */
export async function executeDomainChecks(
  supabaseClient?: SupabaseClient | any
): Promise<ExecuteDomainChecksResult> {
  const summary: ExecuteDomainChecksResult = {
    total_domains: 0,
    dns_checked: 0,
    dns_skipped_24h: 0,
    expirations: {
      checked: 0,
      alerted: 0,
      skipped: 0,
      details: [],
    },
  };

  try {
    let client = supabaseClient;
    if (!client) {
      const { createServiceClient } = await import("@/lib/supabase/server");
      client = createServiceClient();
    }

    const { data: allDomains, error } = await (
      client.from("domains") as any
    ).select("id, domain, expected_target, expires_at, dns_checked_at");

    if (!error && Array.isArray(allDomains)) {
      summary.total_domains = allDomains.length;
      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

      for (const dom of allDomains) {
        const lastCheckedMs = dom.dns_checked_at
          ? new Date(dom.dns_checked_at).getTime()
          : 0;

        if (!lastCheckedMs || isNaN(lastCheckedMs) || lastCheckedMs < cutoff24h) {
          await checkDomain(client, dom);
          summary.dns_checked++;
        } else {
          summary.dns_skipped_24h++;
        }
      }
    }

    summary.expirations = await checkDomainExpirations(client);
  } catch (err) {
    console.error("[DOMAINS] Excepción en executeDomainChecks:", err);
  }

  return summary;
}
