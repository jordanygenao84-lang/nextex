/**
 * NEXTEХ Agent Core — Herramienta Nativa: Lector Web (web_fetch)
 * Extrae y limpia el contenido legible de una página web eliminando tags HTML,
 * scripts y estilos, con protección SSRF y límite de caracteres.
 */

import * as cheerio from "cheerio";
import { ToolExecutionContext } from "../types";
import { executeSafeHttpRequest, validateUrlForSsrf } from "./http_ssrf";

export interface WebFetchParams {
  url: string;
  maxChars?: number;
  includeLinks?: boolean;
}

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  links?: string[];
  truncated: boolean;
  durationMs: number;
}

export async function webFetchToolHandler(
  arg1: Record<string, any> | ToolExecutionContext,
  arg2?: Record<string, any> | ToolExecutionContext
): Promise<{ result: WebFetchResult; metadata: Record<string, any> }> {
  let params: Record<string, any>;
  let context: ToolExecutionContext;

  if (arg1 && typeof arg1 === "object" && ("agentId" in arg1 || "workspaceId" in arg1 || "runId" in arg1)) {
    context = arg1 as ToolExecutionContext;
    params = (arg2 || {}) as Record<string, any>;
  } else {
    params = (arg1 || {}) as Record<string, any>;
    context = (arg2 || {}) as ToolExecutionContext;
  }

  const rawUrl = params.url || params.target_url || params.endpoint;
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Parámetro 'url' requerido para la herramienta web_fetch.");
  }

  const parsedUrl = validateUrlForSsrf(rawUrl.trim());
  const initialUrl = parsedUrl.toString();

  const requestedMaxChars = Number(params.maxChars);
  const safeMaxChars = !isNaN(requestedMaxChars) && requestedMaxChars > 0
    ? Math.min(requestedMaxChars, 100000)
    : 20000;

  const includeLinks = Boolean(params.includeLinks);

  const responseData = await executeSafeHttpRequest({
    url: initialUrl,
    method: "GET",
    timeoutMs: 20000,
  });

  const rawBody = responseData.rawText ?? responseData.bodyText ?? "";
  const contentType = (responseData.headers["content-type"] || "").toLowerCase();
  const isHtml = contentType.includes("html") || rawBody.includes("<html") || rawBody.includes("<body");

  let title = "";
  let extractedText = "";
  let linksList: string[] | undefined = undefined;

  if (!isHtml) {
    extractedText = rawBody.trim();
  } else {
    const $ = cheerio.load(rawBody);

    title = $("title").first().text().trim() || $("h1").first().text().trim() || "";

    if (includeLinks) {
      const extractedLinks: string[] = [];
      const seenHrefs = new Set<string>();

      $("a[href]").each((_, el) => {
        if (extractedLinks.length >= 100) return;
        const href = $(el).attr("href");
        if (!href) return;

        try {
          const resolvedUrl = new URL(href, responseData.finalUrl);
          if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
            const finalHref = resolvedUrl.toString();
            if (!seenHrefs.has(finalHref)) {
              seenHrefs.add(finalHref);
              const anchorText = $(el).text().replace(/\s+/g, " ").trim() || "enlace";
              extractedLinks.push(`- ${anchorText} → ${finalHref}`);
            }
          }
        } catch {
          // Ignorar URLs inválidas
        }
      });

      linksList = extractedLinks;
    }

    $("script, style, nav, header, footer, aside, iframe, noscript, svg, form").remove();

    let textCandidate = $("main").text().trim();
    if (!textCandidate) {
      textCandidate = $("article").text().trim();
    }
    if (!textCandidate) {
      textCandidate = $("body").text().trim();
    }
    if (!textCandidate) {
      textCandidate = $.root().text().trim();
    }

    extractedText = textCandidate
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();
  }

  const truncated = extractedText.length > safeMaxChars;
  const cleanText = extractedText.slice(0, safeMaxChars);

  const result: WebFetchResult = {
    url: initialUrl,
    finalUrl: responseData.finalUrl,
    title,
    text: cleanText,
    ...(includeLinks ? { links: linksList || [] } : {}),
    truncated,
    durationMs: responseData.durationMs,
  };

  return {
    result,
    metadata: {
      tool: "web_fetch",
      status: responseData.status,
      durationMs: responseData.durationMs,
      truncated,
      charsCount: cleanText.length,
      executedAt: new Date().toISOString(),
      workspaceId: context?.workspaceId,
      agentId: context?.agentId,
    },
  };
}
