/**
 * NEXTEХ Agent Core — Herramienta Nativa: Lector HTTP (http_get)
 */

import { ToolExecutionContext } from "../types";
import { executeSafeHttpRequest, validateUrlForSsrf, HttpResponseData } from "./http_ssrf";

export async function httpGetToolHandler(
  arg1: Record<string, any> | ToolExecutionContext,
  arg2?: Record<string, any> | ToolExecutionContext
): Promise<{ result: HttpResponseData; metadata: Record<string, any> }> {
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
    throw new Error("Parámetro 'url' requerido para la herramienta http_get.");
  }

  const parsedUrl = validateUrlForSsrf(rawUrl.trim());
  if (params.query && typeof params.query === "object") {
    for (const [key, value] of Object.entries(params.query)) {
      if (value !== undefined && value !== null) {
        parsedUrl.searchParams.set(key, String(value));
      }
    }
  }

  const timeoutMs = params.timeoutMs ? Number(params.timeoutMs) : 15000;
  const customHeaders = typeof params.headers === "object" && params.headers !== null ? params.headers : undefined;

  const responseData = await executeSafeHttpRequest({
    url: parsedUrl.toString(),
    method: "GET",
    headers: customHeaders,
    timeoutMs,
  });

  return {
    result: responseData,
    metadata: {
      tool: "http_get",
      status: responseData.status,
      durationMs: responseData.durationMs,
      executedAt: new Date().toISOString(),
      workspaceId: context?.workspaceId,
      agentId: context?.agentId,
    },
  };
}
