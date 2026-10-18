import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { webFetchToolHandler } from "@/lib/agents/tools/builtins/web_fetch";

export const dynamic = "force-dynamic";

/**
 * Heurística sin IA para extraer ternas de números ganadores (2-3 dígitos)
 * cerca de las horas de sorteo o del texto extraído de la página oficial.
 * Cero tokens de inferencia consumidos.
 */
function extractLotteryNumbers(
  fullText: string,
  drawTime: string
): string[] | null {
  if (!fullText) return null;

  // 1. Extraer los componentes de la hora (ej: "20:55" -> ["20", "55"]) para no confundirlos con premios
  const timeParts = drawTime.split(/[:\s]/).filter(Boolean);

  // 2. Buscar ventana de texto alrededor de la hora de sorteo (±250 caracteres)
  let windowText = "";
  const timeIndex = fullText.indexOf(drawTime);
  if (timeIndex !== -1) {
    const start = Math.max(0, timeIndex - 250);
    const end = Math.min(fullText.length, timeIndex + 250);
    windowText = fullText.slice(start, end);
  } else {
    // Si no aparece la hora exacta, buscar en los primeros 3000 caracteres
    windowText = fullText.slice(0, 3000);
  }

  // 3. Buscar patrones agrupados de 3 números (ej: "12 - 45 - 89" o "12 45 89")
  const clusterRegex = /\b(\d{2,3})[\s\-–,]+(\d{2,3})[\s\-–,]+(\d{2,3})\b/g;
  let match = clusterRegex.exec(windowText);

  while (match) {
    const candidate = [match[1], match[2], match[3]];
    // Verificar que no sea la hora de sorteo o una fecha
    const overlapsTime = candidate.some((num) => timeParts.includes(num));
    if (!overlapsTime) {
      return candidate;
    }
    match = clusterRegex.exec(windowText);
  }

  // 4. Heurística secundaria: extraer números aislados de 2 dígitos descartando los de la hora
  const digitRegex = /\b\d{2}\b/g;
  const allDigits: string[] = [];
  let dMatch = digitRegex.exec(windowText);

  while (dMatch) {
    const val = dMatch[0];
    if (!timeParts.includes(val) && !allDigits.includes(val)) {
      allDigits.push(val);
      if (allDigits.length === 3) {
        return allDigits;
      }
    }
    dMatch = digitRegex.exec(windowText);
  }

  return allDigits.length > 0 ? allDigits.slice(0, 3) : null;
}

/**
 * POST /api/lotteries/[id]/fetch
 * Dispara la captura y extracción heurística (sin IA) de los números de la lotería.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sesión requerida." },
        { status: 401 }
      );
    }

    const lotteryId = params.id;
    const serviceClient = createServiceClient();

    // 1. Obtener datos del catálogo
    const { data: lottery, error: lotErr } = await (serviceClient.from("lottery_catalog") as any)
      .select("id, name, official_url, draw_times, extraction_rules, is_active")
      .eq("id", lotteryId)
      .maybeSingle();

    if (lotErr || !lottery) {
      return NextResponse.json(
        { ok: false, error: "Lotería no encontrada." },
        { status: 404 }
      );
    }

    if (!lottery.official_url) {
      return NextResponse.json(
        { ok: false, error: "La lotería no tiene official_url configurada." },
        { status: 400 }
      );
    }

    // 2. Traer el texto limpio mediante web_fetch (cheerio sin tags ni scripts)
    let fetchedText = "";
    try {
      const outcome = await webFetchToolHandler({
        url: lottery.official_url,
        maxChars: 40000,
      });
      fetchedText = outcome?.result?.text || "";
    } catch (fetchErr: any) {
      return NextResponse.json(
        {
          ok: false,
          error: `Error al consultar la web oficial: ${fetchErr?.message || fetchErr}`,
        },
        { status: 502 }
      );
    }

    if (!fetchedText.trim()) {
      return NextResponse.json(
        { ok: false, error: "La web oficial no devolvió contenido textual legible." },
        { status: 502 }
      );
    }

    // 3. Extraer números para cada hora de sorteo programada
    const drawTimes: string[] =
      Array.isArray(lottery.draw_times) && lottery.draw_times.length > 0
        ? lottery.draw_times
        : ["12:00"];

    const todayDate = new Date().toISOString().slice(0, 10);
    let savedCount = 0;

    for (const dTime of drawTimes) {
      const numbers = extractLotteryNumbers(fetchedText, dTime);

      if (numbers && numbers.length > 0) {
        const { error: upsertErr } = await (serviceClient.from("lottery_results") as any).upsert(
          {
            lottery_id: lottery.id,
            draw_date: todayDate,
            draw_time: dTime,
            numbers,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "lottery_id,draw_date,draw_time" }
        );

        if (!upsertErr) {
          savedCount++;
        }
      }
    }

    // Si la heurística no encontró números específicos cerca de las horas pero hay texto
    if (savedCount === 0) {
      // Intento global de captura
      const fallbackNumbers = extractLotteryNumbers(fetchedText, "");
      if (fallbackNumbers && fallbackNumbers.length > 0) {
        const defaultTime = drawTimes[0] || "12:00";
        const { error: fallbackErr } = await (serviceClient.from("lottery_results") as any).upsert(
          {
            lottery_id: lottery.id,
            draw_date: todayDate,
            draw_time: defaultTime,
            numbers: fallbackNumbers,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "lottery_id,draw_date,draw_time" }
        );

        if (!fallbackErr) {
          savedCount = 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      saved: savedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Error al capturar resultados." },
      { status: 500 }
    );
  }
}
