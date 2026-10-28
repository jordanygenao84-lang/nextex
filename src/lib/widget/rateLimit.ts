import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

// Rate limit persistente del widget público: 30 mensajes/minuto por
// (embed_key + IP). La IP nunca se guarda en claro: la clave del bucket
// es el SHA-256 de "embed_key:ip".
// Si la tabla widget_rate_limits aún no existe (migración sin aplicar),
// cae al límite en memoria de siempre para no romper el endpoint.
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 30;

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function checkMemory(key: string): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

export async function checkWidgetRateLimit(rawKey: string): Promise<boolean> {
  const bucketKey = createHash("sha256").update(rawKey).digest("hex");
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const resetAt = new Date(now.getTime() + WINDOW_MS);

    const { data: row, error: readErr } = await (supabase.from("widget_rate_limits") as any)
      .select("count, reset_at")
      .eq("bucket_key", bucketKey)
      .maybeSingle();

    // Tabla ausente o error de lectura: respaldo en memoria.
    if (readErr) {
      return checkMemory(rawKey);
    }

    if (!row || new Date(row.reset_at).getTime() <= now.getTime()) {
      const { error: upsertErr } = await (supabase.from("widget_rate_limits") as any).upsert(
        { bucket_key: bucketKey, count: 1, reset_at: resetAt.toISOString() },
        { onConflict: "bucket_key" }
      );
      if (upsertErr) {
        return checkMemory(rawKey);
      }
      return true;
    }

    if (row.count >= MAX_PER_WINDOW) {
      return false;
    }

    const { error: incErr } = await (supabase.from("widget_rate_limits") as any)
      .update({ count: row.count + 1 })
      .eq("bucket_key", bucketKey);
    if (incErr) {
      return checkMemory(rawKey);
    }
    return true;
  } catch {
    return checkMemory(rawKey);
  }
}
