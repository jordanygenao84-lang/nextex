/**
 * NEXTEХ Agent Core — Seguridad HTTP y Protección Anti-SSRF (con resolución DNS)
 */

import dns from "dns";

export const AGENT_USER_AGENT = "nextex-agent/1.0";
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_BODY_TEXT_CHARS = 50000; // 50k chars
export const MAX_REDIRECTS = 3;

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [b0, b1] = parts;
  if (b0 === 0) return true;
  if (b0 === 127) return true;
  if (b0 === 10) return true;
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  if (b0 === 192 && b1 === 168) return true;
  if (b0 === 169 && b1 === 254) return true; // link-local y metadata 169.254.169.254
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const cleanIp = ip.replace(/^\[|\]$/g, "").toLowerCase().trim();
  if (
    cleanIp === "::1" ||
    cleanIp === "::" ||
    cleanIp === "0:0:0:0:0:0:0:1" ||
    cleanIp === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }
  if (cleanIp.startsWith("::ffff:") || cleanIp.startsWith("0:0:0:0:0:ffff:")) {
    const v4 = cleanIp.split(":").pop();
    if (v4 && isPrivateIPv4(v4)) return true;
  }
  if (
    cleanIp.startsWith("fe8") ||
    cleanIp.startsWith("fe9") ||
    cleanIp.startsWith("fea") ||
    cleanIp.startsWith("feb")
  ) {
    return true;
  }
  if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) {
    return true;
  }
  return false;
}

export function validateUrlForSsrf(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("URL requerida.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL inválida.");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("protocolo no permitido");
  }

  // MEDIO 2026-10-28: sin lista de puertos, un agente podía apuntar a
  // puertos internos (bases de datos, paneles) en hosts públicos. Solo el
  // puerto por defecto del protocolo.
  const defaultPort = protocol === "http:" ? "80" : "443";
  if (parsed.port && parsed.port !== defaultPort) {
    throw new Error("puerto no permitido");
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("destino privado no permitido (SSRF)");
  }

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new Error("destino privado no permitido (SSRF)");
    }
  }

  if (hostname.startsWith("[") || hostname.includes(":")) {
    if (isPrivateIPv6(hostname)) {
      throw new Error("destino privado no permitido (SSRF)");
    }
  }

  const allowlistEnv = process.env.HTTP_TOOL_ALLOWLIST;
  if (allowlistEnv && allowlistEnv.trim()) {
    const allowedDomains = allowlistEnv
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (allowedDomains.length > 0) {
      const isAllowed = allowedDomains.some((domain) => {
        return hostname === domain || hostname.endsWith(`.${domain}`);
      });
      if (!isAllowed) {
        throw new Error("dominio no autorizado");
      }
    }
  }

  return parsed;
}

/**
 * Valida el hostname literal contra SSRF y luego resuelve todas sus IPs con dns.lookup({ all: true }),
 * rechazando el destino si cualquiera de las IPs resueltas es privada o de metadata (169.254.169.254).
 */
export async function validateUrlAndResolveDnsForSsrf(rawUrl: string): Promise<URL> {
  const parsed = validateUrlForSsrf(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().trim();

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const isLiteralIp = ipv4Pattern.test(hostname) || hostname.includes(":");

  if (isLiteralIp) {
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
      throw new Error("destino privado no permitido (SSRF)");
    }
    return parsed;
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`No se pudo resolver DNS para ${hostname}`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Sin registros DNS válidos para ${hostname}`);
  }

  for (const rec of records) {
    const addr = (rec.address || "").trim();
    if (!addr || isPrivateIPv4(addr) || isPrivateIPv6(addr)) {
      throw new Error("destino privado no permitido (SSRF)");
    }
  }

  return parsed;
}

export const validateHttpUrl = validateUrlForSsrf;

export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "proxy-authorization") {
      clean[key] = "***";
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export interface HttpRequestExecutionOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponseData {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  rawText?: string;
  bodyJson: any | null;
  finalUrl: string;
  durationMs: number;
}

export async function executeSafeHttpRequest(
  options: HttpRequestExecutionOptions
): Promise<HttpResponseData> {
  const startTime = Date.now();
  const method = (options.method || "GET").toUpperCase();

  let currentUrl = (await validateUrlAndResolveDnsForSsrf(options.url)).toString();
  let redirectCount = 0;

  const requestedTimeout = Number(options.timeoutMs) || 15000;
  const safeTimeoutMs = Math.min(Math.max(1000, requestedTimeout), 30000);

  const requestHeaders: Record<string, string> = {
    "User-Agent": AGENT_USER_AGENT,
    "Accept": "*/*",
    ...(options.headers || {}),
  };

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);

    try {
      // MEDIO 2026-10-28 (mitigación TOCTOU): la validación DNS y el fetch
      // resuelven por separado, así que un DNS fast-flux podría cambiar
      // la IP entre ambas. Se revalida justo antes de cada fetch: el
      // atacante debe ganar la carrera dos veces seguidas, no una. La
      // eliminación total exigiría fijar la IP a nivel de conexión
      // (lookup propio en http/https), un rewrite mayor que queda como
      // paso siguiente, no como parte de esta tanda.
      await validateUrlAndResolveDnsForSsrf(currentUrl);
      const res = await fetch(currentUrl, {
        method,
        headers: requestHeaders,
        body: method !== "GET" && method !== "HEAD" ? options.body : undefined,
        redirect: "manual",
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error("Demasiados redireccionamientos (máximo 3).");
        }

        const location = res.headers.get("location");
        if (!location) {
          return await processResponse(res, currentUrl, startTime);
        }

        const nextUrlObj = new URL(location, currentUrl);
        await validateUrlAndResolveDnsForSsrf(nextUrlObj.toString());
        currentUrl = nextUrlObj.toString();
        continue;
      }

      return await processResponse(res, currentUrl, startTime);
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        throw new Error("timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function processResponse(
  res: Response,
  finalUrl: string,
  startTime: number
): Promise<HttpResponseData> {
  const durationMs = Date.now() - startTime;

  const rawHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    rawHeaders[key] = value;
  });
  const headers = redactSensitiveHeaders(rawHeaders);

  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader) {
    const len = parseInt(contentLengthHeader, 10);
    if (!isNaN(len) && len > MAX_RESPONSE_BYTES) {
      throw new Error("respuesta muy grande");
    }
  }

  let bodyBuffer: Buffer;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("respuesta muy grande");
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    bodyBuffer = Buffer.concat(chunks);
  } else {
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("respuesta muy grande");
    }
    bodyBuffer = Buffer.from(arrayBuf);
  }

  const rawText = bodyBuffer.toString("utf-8");
  const bodyText = rawText.slice(0, MAX_BODY_TEXT_CHARS);

  let bodyJson = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("json") || rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
    try {
      bodyJson = JSON.parse(rawText);
    } catch {
      bodyJson = null;
    }
  }

  return {
    status: res.status,
    headers,
    bodyText,
    rawText,
    bodyJson,
    finalUrl,
    durationMs,
  };
}
