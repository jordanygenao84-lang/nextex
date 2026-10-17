/**
 * NEXTEХ Agent Core — Herramienta Nativa: Escritor HTTP (http_post)
 */

import { ToolExecutionContext } from "../types";
import { executeSafeHttpRequest, validateUrlForSsrf, HttpResponseData } from "./http_ssrf";

export async function httpPostToolHandler(
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
    throw new Error("Parámetro 'url' requerido para la herramienta http_post.");
  }

  const validatedUrl = validateUrlForSsrf(rawUrl.trim()).toString();

  const allowedMethods = ["POST", "PUT", "PATCH", "DELETE"];
  let method = (params.method || "POST").toUpperCase();
  if (!allowedMethods.includes(method)) {
    method = "POST";
  }

  const headers = {
    ...(typeof params.headers === "object" && params.headers !== null ? params.headers : {}),
  };

  let serializedBody = undefined;
  if (params.body !== undefined && params.body !== null) {
    if (typeof params.body === "object") {
      serializedBody = JSON.stringify(params.body);
      const hasContentType = Object.keys(headers).some(
        (h) => h.toLowerCase() === "content-type"
      );
      if (!hasContentType) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      serializedBody = String(params.body);
    }
  }

  const timeoutMs = params.timeoutMs ? Number(params.timeoutMs) : 15000;

  const responseData = await executeSafeHttpRequest({
    url: validatedUrl,
    method,
    headers,
    body: serializedBody,
    timeoutMs,
  });

  return {
    result: responseData,
    metadata: {
      tool: "http_post",
      method,
      status: responseData.status,
      durationMs: responseData.durationMs,
      executedAt: new Date().toISOString(),
      workspaceId: context?.workspaceId,
      agentId: context?.agentId,
    },
  };
}
