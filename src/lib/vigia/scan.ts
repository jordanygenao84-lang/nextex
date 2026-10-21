import { SupabaseClient } from "@supabase/supabase-js";
import { sendVigiaAlert } from "@/lib/vigia/notify";

/**
 * NEXTEХ VIGÍA — Motor de Escaneo Periódico de Seguridad (VIG-5 & VIG-6)
 * Escaneo externo directo (sin IA) sobre clientes activos:
 * 1. Cabeceras HTTP de seguridad (HSTS, CSP, X-Frame-Options / frame-ancestors, X-Content-Type-Options).
 * 2. Sondas de rutas sensibles expuestas (/.env, /.env.local, /.git/config, /.git/HEAD).
 * 3. Proximidad de vencimiento de certificado SSL (<15 días).
 * 4. Gestión de ciclo de vida de hallazgos (apertura, deduplicación y auto-cierre 'fixed').
 * 5. Alertas críticas automáticas a Telegram.
 */

export interface DetectedFinding {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  evidence: Record<string, any>;
  fix_prompt: string;
}

export interface ClientScanResult {
  client_id: string;
  display_name: string;
  skipped?: boolean;
  reason?: string;
  new_findings: number;
  closed_findings: number;
}

export interface SecurityScanRunResult {
  scanned: number;
  new_findings: number;
  closed_findings: number;
  details: ClientScanResult[];
}

/**
 * Plantillas de títulos y prompts de corrección guiada (fix_prompt) por tipo de hallazgo.
 */
const FINDING_TEMPLATES: Record<
  string,
  {
    title: string;
    severity: "info" | "warning" | "critical";
    generateFixPrompt: (evidence: Record<string, any>) => string;
  }
> = {
  missing_hsts: {
    title: "Falta cabecera Strict-Transport-Security (HSTS)",
    severity: "warning",
    generateFixPrompt: () =>
      "Configura la cabecera 'Strict-Transport-Security' con el valor 'max-age=63072000; includeSubDomains; preload' en next.config.js (sección headers) o middleware.ts para forzar conexiones HTTPS seguras y prevenir ataques de degradación SSL/TLS.",
  },
  missing_csp: {
    title: "Falta cabecera Content-Security-Policy (CSP)",
    severity: "info",
    generateFixPrompt: () =>
      "Define una cabecera 'Content-Security-Policy' en next.config.js o middleware.ts especificando directivas estrictas (default-src, script-src, style-src, img-src) para mitigar vectores de inyección de código (XSS) y restringir orígenes externos no autorizados.",
  },
  missing_frame_protection: {
    title: "Falta protección contra Clickjacking (X-Frame-Options / frame-ancestors)",
    severity: "warning",
    generateFixPrompt: () =>
      "Agrega la cabecera 'X-Frame-Options: DENY' (o 'SAMEORIGIN') o incluye la directiva 'frame-ancestors \\'none\\'' en tu Content-Security-Policy dentro de next.config.js o middleware.ts para evitar que la aplicación sea embebida en iframes maliciosos.",
  },
  missing_content_type_options: {
    title: "Falta cabecera X-Content-Type-Options: nosniff",
    severity: "info",
    generateFixPrompt: () =>
      "Configura la cabecera 'X-Content-Type-Options: nosniff' en next.config.js o middleware.ts para impedir que los navegadores intenten adivinar el tipo MIME de las respuestas, reduciendo riesgos de ejecución de scripts disfrazados de imágenes o texto.",
  },
  exposed_sensitive_path: {
    title: "Ruta de configuración o repositorio sensible expuesta con HTTP 200",
    severity: "critical",
    generateFixPrompt: (evidence) =>
      `ALERTA CRÍTICA: La ruta sensible '${evidence.path}' respondió con HTTP 200. Bloquea de inmediato el acceso a archivos de entorno (.env) y metadatos de Git (.git) en vercel.json (rewrites/redirects bloqueados) o añade una regla de intercepción 404/403 en middleware.ts.`,
  },
  ssl_expiring: {
    title: "Certificado SSL/TLS próximo a vencer (menos de 15 días)",
    severity: "warning",
    generateFixPrompt: (evidence) =>
      `El certificado SSL/TLS del sitio vencerá en ${evidence.ssl_days_left} días. Renueva el certificado de dominio o verifica la emisión automática en el panel de tu CDN/hosting (Vercel, Cloudflare o proveedor TLS) antes de que expire.`,
  },
};

/**
 * Normaliza la URL agregando protocolo https:// si está ausente y quitando barras finales.
 */
function normalizeUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

/**
 * Escanea la seguridad externa de un cliente específico.
 */
export async function scanClientSecurity(
  supabase: SupabaseClient,
  client: { id: string; display_name: string; website_url: string | null }
): Promise<ClientScanResult> {
  if (!client.website_url || !client.website_url.trim()) {
    return {
      client_id: client.id,
      display_name: client.display_name,
      skipped: true,
      reason: "Sin URL de sitio web registrada",
      new_findings: 0,
      closed_findings: 0,
    };
  }

  const baseUrl = normalizeUrl(client.website_url);
  const detectedFindings = new Map<string, DetectedFinding>();

  // -------------------------------------------------------------
  // a) Chequeo de cabeceras HTTP de seguridad (GET con timeout 8s)
  // -------------------------------------------------------------
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "User-Agent": "nextex-vigia-scanner/1.0",
        Accept: "*/*",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const hsts = res.headers.get("strict-transport-security");
    if (!hsts) {
      detectedFindings.set("missing_hsts", {
        type: "missing_hsts",
        severity: FINDING_TEMPLATES.missing_hsts.severity,
        title: FINDING_TEMPLATES.missing_hsts.title,
        evidence: { header: "Strict-Transport-Security", missing: true },
        fix_prompt: FINDING_TEMPLATES.missing_hsts.generateFixPrompt({}),
      });
    }

    const csp = res.headers.get("content-security-policy") || "";
    if (!csp.trim()) {
      detectedFindings.set("missing_csp", {
        type: "missing_csp",
        severity: FINDING_TEMPLATES.missing_csp.severity,
        title: FINDING_TEMPLATES.missing_csp.title,
        evidence: { header: "Content-Security-Policy", missing: true },
        fix_prompt: FINDING_TEMPLATES.missing_csp.generateFixPrompt({}),
      });
    }

    const xfo = res.headers.get("x-frame-options");
    const hasFrameAncestors = /frame-ancestors/i.test(csp);
    if (!xfo && !hasFrameAncestors) {
      detectedFindings.set("missing_frame_protection", {
        type: "missing_frame_protection",
        severity: FINDING_TEMPLATES.missing_frame_protection.severity,
        title: FINDING_TEMPLATES.missing_frame_protection.title,
        evidence: { missing_headers: ["X-Frame-Options", "CSP frame-ancestors"] },
        fix_prompt: FINDING_TEMPLATES.missing_frame_protection.generateFixPrompt({}),
      });
    }

    const xcto = res.headers.get("x-content-type-options");
    if (!xcto) {
      detectedFindings.set("missing_content_type_options", {
        type: "missing_content_type_options",
        severity: FINDING_TEMPLATES.missing_content_type_options.severity,
        title: FINDING_TEMPLATES.missing_content_type_options.title,
        evidence: { header: "X-Content-Type-Options", missing: true },
        fix_prompt: FINDING_TEMPLATES.missing_content_type_options.generateFixPrompt({}),
      });
    }
  } catch (err: any) {
    console.warn(`[VIGÍA SCAN] Aviso: fallo de conexión al evaluar cabeceras en ${baseUrl}:`, err?.message || err);
  }

  // -------------------------------------------------------------
  // b) Sondas de rutas sensibles expuestas (timeout 5s cada una)
  // -------------------------------------------------------------
  const sensitivePaths = ["/.env", "/.env.local", "/.git/config", "/.git/HEAD"];
  const exposedFound: Array<{ path: string; status: number }> = [];

  for (const path of sensitivePaths) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const probeUrl = `${baseUrl}${path}`;

      const probeRes = await fetch(probeUrl, {
        method: "GET",
        headers: {
          "User-Agent": "nextex-vigia-probe/1.0",
        },
        redirect: "manual", // No seguir redirecciones automáticas a páginas 200 de login/inicio
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Si responde directamente con código HTTP 200 OK
      if (probeRes.status === 200) {
        exposedFound.push({ path, status: 200 });
      }
    } catch {
      // Error de conexión o timeout esperado en rutas protegidas/inexistentes
      continue;
    }
  }

  if (exposedFound.length > 0) {
    const exposedPathsStr = exposedFound.map((e) => e.path).join(", ");
    detectedFindings.set("exposed_sensitive_path", {
      type: "exposed_sensitive_path",
      severity: FINDING_TEMPLATES.exposed_sensitive_path.severity,
      title: FINDING_TEMPLATES.exposed_sensitive_path.title,
      evidence: {
        path: exposedPathsStr,
        exposed_paths: exposedFound,
        status: 200,
      },
      fix_prompt: FINDING_TEMPLATES.exposed_sensitive_path.generateFixPrompt({
        path: exposedPathsStr,
      }),
    });
  }

  // -------------------------------------------------------------
  // c) Proximidad de vencimiento de certificado SSL (<15 días)
  // -------------------------------------------------------------
  try {
    const { data: latestHealth } = await (supabase.from("site_health_checks") as any)
      .select("ssl_days_left")
      .eq("client_id", client.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      latestHealth &&
      latestHealth.ssl_days_left !== null &&
      latestHealth.ssl_days_left !== undefined &&
      Number(latestHealth.ssl_days_left) < 15
    ) {
      detectedFindings.set("ssl_expiring", {
        type: "ssl_expiring",
        severity: FINDING_TEMPLATES.ssl_expiring.severity,
        title: FINDING_TEMPLATES.ssl_expiring.title,
        evidence: { ssl_days_left: Number(latestHealth.ssl_days_left) },
        fix_prompt: FINDING_TEMPLATES.ssl_expiring.generateFixPrompt({
          ssl_days_left: Number(latestHealth.ssl_days_left),
        }),
      });
    }
  } catch (err: any) {
    console.warn(`[VIGÍA SCAN] Error consultando ssl_days_left para ${client.display_name}:`, err?.message || err);
  }

  // -------------------------------------------------------------
  // d) Gestión de hallazgos (source 'scan')
  // -------------------------------------------------------------
  let newFindingsCount = 0;
  let closedFindingsCount = 0;

  // Consultar hallazgos de escaneo abiertos actualmente
  const { data: openFindings } = await (supabase.from("security_findings") as any)
    .select("id, type, title, evidence")
    .eq("client_id", client.id)
    .eq("source", "scan")
    .eq("status", "open");

  const openList = Array.isArray(openFindings) ? openFindings : [];
  const openTypes = new Set(openList.map((f: any) => f.type));

  // 1. Cerrar hallazgos que ya NO aparecen en este escaneo (auto-fix)
  for (const existing of openList) {
    if (!detectedFindings.has(existing.type)) {
      const nowIso = new Date().toISOString();
      await (supabase.from("security_findings") as any)
        .update({
          status: "fixed",
          resolved_at: nowIso,
        })
        .eq("id", existing.id);

      await (supabase.from("incident_log") as any).insert({
        client_id: client.id,
        kind: "finding_fixed",
        title: `Hallazgo resuelto: ${existing.title}`,
        detail: {
          source: "scan",
          type: existing.type,
          finding_id: existing.id,
          resolved_at: nowIso,
        },
      });
      closedFindingsCount++;
    }
  }

  // 2. Insertar hallazgos nuevos (evitando duplicar los ya abiertos)
  const entriesList = Array.from(detectedFindings.entries());
  for (let i = 0; i < entriesList.length; i++) {
    const [findingType, findingData] = entriesList[i];
    if (!openTypes.has(findingType)) {
      const { data: insertedFinding } = await (
        supabase.from("security_findings") as any
      )
        .insert({
          client_id: client.id,
          source: "scan",
          type: findingData.type,
          severity: findingData.severity,
          title: findingData.title,
          evidence: findingData.evidence,
          fix_prompt: findingData.fix_prompt,
          status: "open",
        })
        .select("id")
        .single();

      await (supabase.from("incident_log") as any).insert({
        client_id: client.id,
        kind: "finding_opened",
        title: `Nuevo hallazgo de seguridad: ${findingData.title}`,
        detail: {
          source: "scan",
          type: findingData.type,
          severity: findingData.severity,
          finding_id: insertedFinding?.id || null,
          evidence: findingData.evidence,
        },
      });
      newFindingsCount++;

      // VIG-6: Alerta Telegram para finding crítico de ruta sensible expuesta
      if (findingData.type === "exposed_sensitive_path") {
        await sendVigiaAlert(
          `🚨 Ruta sensible expuesta en ${client.display_name}: ${findingData.evidence?.path}`,
          `Se detectó que la ruta '${findingData.evidence?.path}' responde con código HTTP 200 en ${baseUrl}. Requiere bloqueo inmediato.`,
          { clientId: client.id, kind: "finding_opened" },
          supabase
        );
      }
    }
  }

  // -------------------------------------------------------------
  // e) Registrar fin de escaneo para el cliente (scan_completed)
  // -------------------------------------------------------------
  await (supabase.from("incident_log") as any).insert({
    client_id: client.id,
    kind: "scan_completed",
    title: `Escaneo de seguridad completado (${client.display_name})`,
    detail: {
      findings_nuevos: newFindingsCount,
      findings_cerrados: closedFindingsCount,
      total_detectados: detectedFindings.size,
    },
  });

  return {
    client_id: client.id,
    display_name: client.display_name,
    new_findings: newFindingsCount,
    closed_findings: closedFindingsCount,
  };
}

/**
 * Ejecuta el ciclo global de escaneo de seguridad para todos los clientes activos.
 * Implementa la puerta de 24 horas por cliente: si su último 'scan_completed'
 * ocurrió hace menos de 24h, se omite (salvo que options?.force sea true).
 */
export async function executeVigiaSecurityScans(
  supabase: SupabaseClient,
  options?: { force?: boolean }
): Promise<SecurityScanRunResult> {
  const { data: clients, error: clientsErr } = await (supabase.from("clients") as any)
    .select("id, display_name, website_url, status")
    .eq("status", "active")
    .order("display_name", { ascending: true });

  if (clientsErr || !Array.isArray(clients) || clients.length === 0) {
    return {
      scanned: 0,
      new_findings: 0,
      closed_findings: 0,
      details: [],
    };
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let totalScanned = 0;
  let totalNew = 0;
  let totalClosed = 0;
  const details: ClientScanResult[] = [];

  for (const client of clients) {
    // Puerta de 24 horas por cliente
    if (!options?.force) {
      const { data: latestScan } = await (supabase.from("incident_log") as any)
        .select("created_at")
        .eq("client_id", client.id)
        .eq("kind", "scan_completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestScan?.created_at && latestScan.created_at >= twentyFourHoursAgo) {
        details.push({
          client_id: client.id,
          display_name: client.display_name,
          skipped: true,
          reason: "Puerta de 24h activa (escaneado recientemente)",
          new_findings: 0,
          closed_findings: 0,
        });
        continue;
      }
    }

    const result = await scanClientSecurity(supabase, client);
    if (!result.skipped) {
      totalScanned++;
      totalNew += result.new_findings;
      totalClosed += result.closed_findings;
    }
    details.push(result);
  }

  return {
    scanned: totalScanned,
    new_findings: totalNew,
    closed_findings: totalClosed,
    details,
  };
}
