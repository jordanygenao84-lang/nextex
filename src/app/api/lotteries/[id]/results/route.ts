import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/lotteries/[id]/results?date=YYYY-MM-DD
 * Resultados de un día (default: hoy): [{ draw_time, numbers, fetched_at }]
 * Si no hay resultados guardados → { results: [], message: 'Sin resultados aún para esta fecha' }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const lotteryId = params.id;
    const { searchParams } = new URL(req.url);

    // Fecha solicitada o default: fecha actual local (YYYY-MM-DD)
    const dateParam = searchParams.get("date");
    const targetDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date().toISOString().slice(0, 10);

    const serviceClient = createServiceClient();

    // 1. Verificar si existe la lotería
    const { data: lottery, error: lotErr } = await (serviceClient.from("lottery_catalog") as any)
      .select("id, name")
      .eq("id", lotteryId)
      .maybeSingle();

    if (lotErr || !lottery) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Lotería no encontrada." } },
        { status: 404 }
      );
    }

    // 2. Consultar resultados para la fecha indicada
    const { data: results, error: resErr } = await (serviceClient.from("lottery_results") as any)
      .select("draw_time, numbers, created_at")
      .eq("lottery_id", lotteryId)
      .eq("draw_date", targetDate)
      .order("draw_time", { ascending: true });

    if (resErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: resErr.message } },
        { status: 500 }
      );
    }

    if (!results || results.length === 0) {
      return NextResponse.json({
        results: [],
        message: "Sin resultados aún para esta fecha",
      });
    }

    const formatted = results.map((r: any) => ({
      draw_time: r.draw_time,
      numbers: r.numbers,
      fetched_at: r.created_at,
    }));

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al consultar resultados." } },
      { status: 500 }
    );
  }
}
