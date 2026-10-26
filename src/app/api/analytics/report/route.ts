import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveClientFromSiteKey } from "@/lib/vigia/site-auth";
import { getTodayUtcDateString } from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";

const VALID_METRICS = ["visits", "sales", "orders", "revenue"] as const;
type ValidMetric = (typeof VALID_METRICS)[number];

/**
 * POST /api/analytics/report
 * Endpoint PÚBLICO para ingesta de métricas de negocio desde las webs satélite (NIV2-4).
 *
 * Autenticación:
 *   Header `Authorization: Bearer <clave de sitio ntx_...>`
 *
 * Body JSON:
 *   {
 *     "metric": "visits" | "sales" | "orders" | "revenue",
 *     "value": number (>= 0),
 *     "currency"?: string,
 *     "date"?: "YYYY-MM-DD" (default hoy UTC),
 *     "idempotency_key"?: string (opcional, máx. 128 caracteres)
 *   }
 *
 * Comportamiento:
 *   - Upsert sobre (client_id, metric, metric_date): si existe, SUMA value al existente; si no, inserta.
 *   - SEC-009: si se envía idempotency_key, la primera recepción la registra en
 *     metric_idempotency_keys (migración 20261026_fix_seg8_seg9_seg10.sql) y una
 *     repetición con la misma llave devuelve 204 SIN sumar de nuevo. Si la tabla
 *     aún no existe (migración pendiente), se registra un aviso y se mantiene el
 *     comportamiento anterior (suma) para no romper satélites.
 *   - Respuesta 204 sin cuerpo. Nunca lanza excepción al satélite.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");

    const clientId = await resolveClientFromSiteKey(authHeader);
    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Clave de sitio inválida o ausente.",
          },
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Se requiere un cuerpo JSON válido.",
          },
        },
        { status: 400 }
      );
    }

    const { metric, value, currency, date, idempotency_key } = body;

    if (
      !metric ||
      typeof metric !== "string" ||
      !VALID_METRICS.includes(metric.trim().toLowerCase() as ValidMetric)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `El campo 'metric' debe ser uno de: ${VALID_METRICS.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const parsedValue = Number(value);
    if (
      value === undefined ||
      value === null ||
      typeof value === "boolean" ||
      isNaN(parsedValue) ||
      !isFinite(parsedValue) ||
      parsedValue < 0
    ) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'value' debe ser un número válido >= 0.",
          },
        },
        { status: 400 }
      );
    }

    let metricDate = getTodayUtcDateString();
    if (date !== undefined && date !== null && String(date).trim() !== "") {
      const trimmedDate = String(date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'date' debe tener formato YYYY-MM-DD.",
            },
          },
          { status: 400 }
        );
      }
      metricDate = trimmedDate;
    }

    const normalizedMetric = metric.trim().toLowerCase() as ValidMetric;
    const normalizedCurrency =
      currency && typeof currency === "string" && currency.trim()
        ? currency.trim().toUpperCase()
        : null;

    let normalizedKey: string | null = null;
    if (idempotency_key !== undefined && idempotency_key !== null) {
      if (
        typeof idempotency_key !== "string" ||
        idempotency_key.trim() === "" ||
        idempotency_key.trim().length > 128
      ) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'idempotency_key' debe ser un texto de 1 a 128 caracteres.",
            },
          },
          { status: 400 }
        );
      }
      normalizedKey = idempotency_key.trim();
    }

    const serviceClient = createServiceClient();

    // SEC-009: si la llave ya se registró para este (cliente, métrica, día),
    // es una repetición: devolver 204 sin sumar de nuevo. Si la tabla aún no
    // existe (migración pendiente), avisar y seguir con el comportamiento anterior.
    if (normalizedKey) {
      const { error: keyErr } = await (serviceClient.from("metric_idempotency_keys") as any).insert({
        client_id: clientId,
        metric: normalizedMetric,
        metric_date: metricDate,
        idempotency_key: normalizedKey,
      });
      if (keyErr) {
        if (keyErr.code === "23505") {
          return new NextResponse(null, { status: 204 });
        }
        console.warn(
          "[ANALYTICS REPORT] Idempotencia no disponible (¿migración pendiente?):",
          keyErr.message || keyErr
        );
      }
    }

    const { data: existing, error: selectErr } = await (
      serviceClient.from("business_metrics") as any
    )
      .select("id, value, currency")
      .eq("client_id", clientId)
      .eq("metric", normalizedMetric)
      .eq("metric_date", metricDate)
      .maybeSingle();

    if (selectErr) {
      console.warn(
        "[ANALYTICS REPORT] Error consultando business_metrics:",
        selectErr
      );
    }

    if (existing) {
      const nextValue = (Number(existing.value) || 0) + parsedValue;
      const { error: updateErr } = await (
        serviceClient.from("business_metrics") as any
      )
        .update({
          value: nextValue,
          currency: normalizedCurrency || existing.currency || null,
        })
        .eq("id", existing.id);

      if (updateErr) {
        console.error(
          "[ANALYTICS REPORT] Error sumando business_metric:",
          updateErr
        );
      }
    } else {
      const { error: insertErr } = await (
        serviceClient.from("business_metrics") as any
      ).insert({
        client_id: clientId,
        metric: normalizedMetric,
        value: parsedValue,
        currency: normalizedCurrency,
        metric_date: metricDate,
      });

      if (
        insertErr &&
        (insertErr.code === "23505" ||
          String(insertErr.message || "").toLowerCase().includes("duplicate"))
      ) {
        const { data: retryExisting } = await (
          serviceClient.from("business_metrics") as any
        )
          .select("id, value, currency")
          .eq("client_id", clientId)
          .eq("metric", normalizedMetric)
          .eq("metric_date", metricDate)
          .maybeSingle();

        if (retryExisting) {
          await (serviceClient.from("business_metrics") as any)
            .update({
              value: (Number(retryExisting.value) || 0) + parsedValue,
              currency: normalizedCurrency || retryExisting.currency || null,
            })
            .eq("id", retryExisting.id);
        }
      } else if (insertErr) {
        console.error(
          "[ANALYTICS REPORT] Error insertando business_metric:",
          insertErr
        );
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error(
      "[ANALYTICS REPORT] Excepción procesando métrica de negocio:",
      err
    );
    return new NextResponse(null, { status: 204 });
  }
}
