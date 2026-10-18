import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Normaliza el texto de consulta (lowercase, trim, colapsa espacios en blanco repetidos)
 * y genera un hash SHA-256 en formato hexadecimal.
 */
export function hashQuery(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Busca una respuesta en caché para el workspace especificado si no ha expirado.
 * Si encuentra un hit, incrementa hit_count y retorna { response, model }.
 */
export async function getCachedResponse(
  workspaceId: string,
  queryText: string
): Promise<{ response: string; model: string } | null> {
  if (!workspaceId || !queryText) {
    return null;
  }

  const queryHash = hashQuery(queryText);
  if (!queryHash) {
    return null;
  }

  try {
    const serviceClient = createServiceClient();
    const nowIso = new Date().toISOString();

    const { data: cached, error } = await (serviceClient.from("response_cache") as any)
      .select("id, response, model, hit_count")
      .eq("workspace_id", workspaceId)
      .eq("query_hash", queryHash)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (error || !cached) {
      return null;
    }

    // Incrementar contador de hits de forma asíncrona no bloqueante
    (serviceClient.from("response_cache") as any)
      .update({
        hit_count: (cached.hit_count || 1) + 1,
        updated_at: nowIso,
      })
      .eq("id", cached.id)
      .then(() => {})
      .catch(() => {});

    return {
      response: cached.response,
      model: cached.model,
    };
  } catch (err: any) {
    console.error("Error al consultar response_cache:", err?.message || err);
    return null;
  }
}

/**
 * Guarda o actualiza una respuesta en la caché de respuestas.
 */
export async function setCachedResponse(
  workspaceId: string,
  queryText: string,
  response: string,
  model: string,
  ttlDays: number = 7
): Promise<void> {
  if (!workspaceId || !queryText || !response) {
    return;
  }

  const queryHash = hashQuery(queryText);
  if (!queryHash) {
    return;
  }

  try {
    const serviceClient = createServiceClient();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    await (serviceClient.from("response_cache") as any).upsert(
      {
        workspace_id: workspaceId,
        query_hash: queryHash,
        query_text: queryText.trim(),
        response: response.trim(),
        model: model || "gemini-1.5-flash",
        hit_count: 1,
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      },
      { onConflict: "workspace_id,query_hash" }
    );
  } catch (err: any) {
    console.error("Error al escribir en response_cache:", err?.message || err);
  }
}
