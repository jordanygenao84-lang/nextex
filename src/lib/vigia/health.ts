/**
 * NEXTEХ VIGÍA — Motor de Chequeo de Salud y Disponibilidad (VIG-2 & VIG-3)
 * Chequea latencia HTTP, disponibilidad web, vencimiento de certificados TLS
 * y registra incidentes en transición de estado (health_down / health_recovered).
 */

import tls from "tls";
import { URL } from "url";
import { SupabaseClient } from "@supabase/supabase-js";

export interface HealthCheckRunResult {
  skipped?: boolean;
  checked?: number;
  down?: number;
  degraded?: number;
}

/**
 * Obtiene los días restantes de validez del certificado TLS para una URL HTTPS.
 * Utiliza tls.connect al puerto 443 con SNI (servername).
 * Si la conexión falla o el certificado es inválido, retorna null sin lanzar excepción.
 */
export async function getSslDaysLeft(rawUrl: string): Promise<number | null> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return null;
    }

    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 443;

    return await new Promise<number | null>((resolve) => {
      const socket = tls.connect(
        {
          host,
          port,
          servername: host,
          rejectUnauthorized: false,
          timeout: 5000,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            socket.destroy();

            if (!cert || !cert.valid_to) {
              resolve(null);
              return;
            }

            const validTo = new Date(cert.valid_to);
            const now = new Date();
            const diffMs = validTo.getTime() - now.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            resolve(diffDays);
          } catch {
            socket.destroy();
            resolve(null);
          }
        }
      );

      socket.on("error", () => {
        socket.destroy();
        resolve(null);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Ejecuta el ciclo de chequeo de salud para todos los clientes activos.
 * Incluye puerta de debounce de 5 minutos (salvo que options?.force === true).
 */
export async function executeVigiaHealthChecks(
  supabase: SupabaseClient,
  options?: { force?: boolean }
): Promise<HealthCheckRunResult> {
  // 1. Puerta de debounce de 5 minutos (omitida si force = true)
  if (!options?.force) {
    const { data: latestCheck } = await (supabase.from("site_health_checks") as any)
      .select("checked_at")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestCheck?.checked_at) {
      const diffMs = Date.now() - new Date(latestCheck.checked_at).getTime();
      if (diffMs < 5 * 60 * 1000) {
        return { skipped: true };
      }
    }
  }

  // 2. Consultar clientes activos con URL web
  const { data: clients, error: clientsErr } = await (supabase.from("clients") as any)
    .select("id, display_name, website_url")
    .eq("status", "active");

  if (clientsErr || !Array.isArray(clients) || clients.length === 0) {
    return { checked: 0, down: 0, degraded: 0 };
  }

  let checkedCount = 0;
  let downCount = 0;
  let degradedCount = 0;

  for (const client of clients) {
    const rawUrl = client.website_url?.trim();
    if (!rawUrl) continue;

    checkedCount++;

    // Preparar URL normalizada
    let targetUrl = rawUrl;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`;
    }

    // a) GET a la URL midiendo el tiempo de respuesta (timeout 10s)
    const startTime = Date.now();
    let responseMs = 0;
    let httpStatus: number | null = null;
    let status: "ok" | "degraded" | "down" = "down";
    let fetchError: string | null = null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "NextexVigiaHealthBot/1.0 (+https://nextex-seven.vercel.app)",
        },
        signal: controller.signal,
      });

      responseMs = Date.now() - startTime;
      httpStatus = res.status;

      // b) Determinación de estado:
      // - 2xx/3xx y < 2500ms -> 'ok'
      // - responde pero >= 2500ms -> 'degraded'
      // - error, timeout o 5xx -> 'down'
      if (httpStatus >= 500) {
        status = "down";
      } else if (responseMs >= 2500) {
        status = "degraded";
      } else if (httpStatus >= 200 && httpStatus < 400) {
        status = "ok";
      } else {
        // Códigos 4xx se catalogan como degraded (respondió servidor pero recurso no encontrado/prohibido)
        status = "degraded";
      }
    } catch (err: any) {
      responseMs = Date.now() - startTime;
      fetchError = err?.name === "AbortError" ? "Timeout de 10s alcanzado" : err?.message || "Error de red";
      status = "down";
    } finally {
      clearTimeout(timeoutId);
    }

    if (status === "down") downCount++;
    if (status === "degraded") degradedCount++;

    // c) Días restantes de certificado TLS si es https
    const sslDaysLeft = targetUrl.startsWith("https:") ? await getSslDaysLeft(targetUrl) : null;

    // e) Consultar chequeo anterior para registrar incidentes SOLO en transición
    const { data: prevCheck } = await (supabase.from("site_health_checks") as any)
      .select("status")
      .eq("client_id", client.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevStatus = prevCheck?.status || null;

    // d) Insertar nuevo registro en site_health_checks
    await (supabase.from("site_health_checks") as any).insert({
      client_id: client.id,
      status,
      response_ms: responseMs,
      ssl_days_left: sslDaysLeft,
      details: {
        http_status: httpStatus,
        url: targetUrl,
        error: fetchError,
      },
    });

    // e) Evaluar transición para incident_log:
    // Transición hacia caída: ok/degraded -> down
    if (prevStatus && prevStatus !== "down" && status === "down") {
      await (supabase.from("incident_log") as any).insert({
        client_id: client.id,
        kind: "health_down",
        title: `Caída detectada en sitio web de ${client.display_name}`,
        detail: {
          url: targetUrl,
          previous_status: prevStatus,
          current_status: "down",
          http_status: httpStatus,
          response_ms: responseMs,
          error: fetchError,
        },
      });
    }

    // Transición hacia recuperación: down -> ok
    if (prevStatus === "down" && status === "ok") {
      await (supabase.from("incident_log") as any).insert({
        client_id: client.id,
        kind: "health_recovered",
        title: `Servicio web restablecido para ${client.display_name}`,
        detail: {
          url: targetUrl,
          previous_status: "down",
          current_status: "ok",
          http_status: httpStatus,
          response_ms: responseMs,
        },
      });
    }
  }

  return {
    checked: checkedCount,
    down: downCount,
    degraded: degradedCount,
  };
}
