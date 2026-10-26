import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/lotteries
 * Endpoint PÚBLICO INTENCIONAL: lista el catálogo público activo de loterías
 * (tabla pública lottery_catalog): [{ id, name, official_url, draw_times }].
 * Nunca expone mensajes internos de base de datos ni detalles de esquema.
 */
export async function GET(_req: NextRequest) {
  try {
    const serviceClient = createServiceClient();

    const { data: lotteries, error } = await (serviceClient.from("lottery_catalog") as any)
      .select("id, name, official_url, draw_times")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
        { status: 500 }
      );
    }

    return NextResponse.json(lotteries || []);
  } catch {
    return NextResponse.json(
      { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
      { status: 500 }
    );
  }
}
