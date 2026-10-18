import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/lotteries
 * Lista el catálogo activo de loterías: [{ id, name, official_url, draw_times }]
 */
export async function GET(req: NextRequest) {
  try {
    const serviceClient = createServiceClient();

    const { data: lotteries, error } = await (serviceClient.from("lottery_catalog") as any)
      .select("id, name, official_url, draw_times")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(lotteries || []);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al obtener catálogo de loterías." } },
      { status: 500 }
    );
  }
}
