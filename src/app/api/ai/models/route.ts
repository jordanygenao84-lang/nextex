import { NextResponse } from "next/server";
import { getModelRegistry } from "@/lib/omniengine/registry/models";

/**
 * GET /api/ai/models
 * Retorna el catálogo canónico de modelos para el frontend sin exponer secretos.
 */
export async function GET() {
  const models = getModelRegistry();
  return NextResponse.json({
    models,
    timestamp: new Date().toISOString(),
  });
}
