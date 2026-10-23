import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveClientFromSiteKey } from "@/lib/vigia/site-auth";
import { calculateErrorFingerprint } from "@/lib/protection/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/errors/report
 * Endpoint PÚBLICO para reporte central de errores de webs satélite (NIV1-4).
 *
 * Autenticación:
 *   Header `Authorization: Bearer <clave de sitio ntx_...>`
 *
 * Body JSON:
 *   {
 *     "error_type"?: string,
 *     "message": string (obligatorio),
 *     "detail"?: object
 *   }
 *
 * Comportamiento:
 *   - Normaliza mensaje (recorte a 200 chars, dígitos reemplazados por '0')
 *   - Calcula fingerprint SHA-256
 *   - Upsert sobre (client_id, fingerprint):
 *     - Si existe: occurrences + 1, last_seen_at = now(), message/detail actualizados
 *     - Si no: insert con occurrences = 1
 *   - Retorna 204 sin cuerpo. Nunca lanza excepción al cliente.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Validar autenticación con clave de sitio
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

    // 2. Parsear y validar cuerpo de la petición
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

    const { error_type, message, detail } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'message' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const trimmedMsg = message.trim();
    const errorTypeStr =
      error_type && typeof error_type === "string" && error_type.trim()
        ? error_type.trim()
        : null;

    const eventDetail =
      detail && typeof detail === "object"
        ? detail
        : detail
        ? { raw: detail }
        : {};

    // 3. Calcular fingerprint en el servidor
    const fingerprint = calculateErrorFingerprint(
      clientId,
      errorTypeStr,
      trimmedMsg
    );

    const serviceClient = createServiceClient();

    // 4. Upsert atómico sobre (client_id, fingerprint)
    const { data: existing, error: selectErr } = await (
      serviceClient.from("error_events") as any
    )
      .select("id, occurrences")
      .eq("client_id", clientId)
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    if (selectErr) {
      console.warn(
        "[ERRORS REPORT] Error consultando error_events:",
        selectErr
      );
    }

    if (existing) {
      const nextOccurrences = (Number(existing.occurrences) || 1) + 1;
      const { error: updateErr } = await (
        serviceClient.from("error_events") as any
      )
        .update({
          occurrences: nextOccurrences,
          last_seen_at: new Date().toISOString(),
          message: trimmedMsg,
          detail: eventDetail,
          error_type: errorTypeStr,
        })
        .eq("id", existing.id);

      if (updateErr) {
        console.error(
          "[ERRORS REPORT] Error actualizando grupo de error:",
          updateErr
        );
      }
    } else {
      const { error: insertErr } = await (
        serviceClient.from("error_events") as any
      ).insert({
        client_id: clientId,
        fingerprint,
        error_type: errorTypeStr,
        message: trimmedMsg,
        detail: eventDetail,
        occurrences: 1,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });

      // Manejo de carrera por concurrencia sobre índice único
      if (
        insertErr &&
        (insertErr.code === "23505" ||
          insertErr.message?.includes("duplicate key"))
      ) {
        const { data: retryExisting } = await (
          serviceClient.from("error_events") as any
        )
          .select("id, occurrences")
          .eq("client_id", clientId)
          .eq("fingerprint", fingerprint)
          .maybeSingle();

        if (retryExisting) {
          await (serviceClient.from("error_events") as any)
            .update({
              occurrences: (Number(retryExisting.occurrences) || 1) + 1,
              last_seen_at: new Date().toISOString(),
              message: trimmedMsg,
              detail: eventDetail,
              error_type: errorTypeStr,
            })
            .eq("id", retryExisting.id);
        }
      } else if (insertErr) {
        console.error(
          "[ERRORS REPORT] Error insertando nuevo error_event:",
          insertErr
        );
      }
    }

    // 5. Retornar 204 sin contenido
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error(
      "[ERRORS REPORT] Excepción no controlada procesando reporte de error:",
      err
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            err?.message || "Error interno al procesar reporte de error.",
        },
      },
      { status: 500 }
    );
  }
}
