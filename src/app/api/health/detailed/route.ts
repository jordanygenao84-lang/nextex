import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/detailed — Readiness Probe
 * Comprueba dependencias esenciales (conectividad con Supabase DB).
 * NUNCA filtra variables de entorno, claves, URLs de DB ni stack traces.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  let dbHealthy = false;

  try {
    const supabase = createServiceClient();
    // Consulta canónica mínima para validar conectividad con el pool
    const { data, error } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1);

    if (!error && Array.isArray(data)) {
      dbHealthy = true;
    }
  } catch {
    dbHealthy = false;
  }

  if (!dbHealthy) {
    return NextResponse.json(
      {
        status: "degraded",
        services: {
          web: "healthy",
          database: "unhealthy",
        },
        timestamp,
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: "ready",
      services: {
        web: "healthy",
        database: "healthy",
      },
      timestamp,
    },
    { status: 200 }
  );
}
