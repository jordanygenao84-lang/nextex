import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * GET /api/lotteries/[id]/results?date=YYYY-MM-DD
 * Endpoint PÚBLICO INTENCIONAL: expone únicamente resultados públicos de sorteos
 * (tablas públicas lottery_catalog y lottery_results).
 * Resultados de un día (default: hoy): [{ draw_time, numbers, fetched_at }]
 * Si no hay resultados guardados → { results: [], message: 'Sin resultados aún para esta fecha' }
 * Nunca expone mensajes internos de base de datos ni nombres de columnas.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const lotteryId = (params.id || "").trim();
    if (!UUID_REGEX.test(lotteryId)) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Lotería no encontrada." } },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");

    if (dateParam !== null && dateParam.trim() !== "" && !isValidCalendarDate(dateParam.trim())) {
      return NextResponse.json(
        { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
        { status: 400 }
      );
    }

    const targetDate =
      dateParam && dateParam.trim() !== ""
        ? dateParam.trim()
        : new Date().toISOString().slice(0, 10);

    const serviceClient = createServiceClient();

    // 1. Verificar si existe la lotería
    const { data: lottery, error: lotErr } = await (serviceClient.from("lottery_catalog") as any)
      .select("id, name")
      .eq("id", lotteryId)
      .maybeSingle();

    if (lotErr) {
      return NextResponse.json(
        { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
        { status: 500 }
      );
    }

    if (!lottery) {
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
        { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
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
  } catch {
    return NextResponse.json(
      { error: { code: "QUERY_ERROR", message: "Error al consultar resultados." } },
      { status: 500 }
    );
  }
}
