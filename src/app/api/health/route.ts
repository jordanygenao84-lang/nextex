import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — Liveness Probe
 * Comprueba que el servidor HTTP Next.js está vivo y respondiendo.
 * Cero I/O externo, cero dependencias de DB, nunca filtra secretos.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
