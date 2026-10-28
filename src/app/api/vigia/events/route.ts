import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveClientFromSiteKey } from "@/lib/vigia/site-auth";
import { runSecurityDetection } from "@/lib/vigia/detection";

export const dynamic = "force-dynamic";

const VALID_EVENT_TYPES = [
  "failed_login",
  "rate_limited",
  "suspicious_path",
  "auth_spike",
  "other",
] as const;

type ValidEventType = (typeof VALID_EVENT_TYPES)[number];

/**
 * POST /api/vigia/events
 * Endpoint PÚBLICO para que las webs satélite (Infinite Smells, Capitalia, etc.)
 * reporten eventos de seguridad sin requerir sesión de usuario.
 *
 * Autenticación:
 *   Header `Authorization: Bearer <clave de sitio ntx_...>`
 *
 * Body JSON:
 *   {
 *     "event_type": "failed_login" | "rate_limited" | "suspicious_path" | "auth_spike" | "other",
 *     "ip"?: string,
 *     "detail"?: object
 *   }
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

    const { event_type, ip, detail } = body;

    if (
      !event_type ||
      typeof event_type !== "string" ||
      !VALID_EVENT_TYPES.includes(event_type as ValidEventType)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_EVENT_TYPE",
            message: `event_type debe ser uno de: ${VALID_EVENT_TYPES.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const normalizedIp =
      typeof ip === "string" && ip.trim().length > 0 ? ip.trim() : null;
    const eventDetail =
      detail && typeof detail === "object"
        ? detail
        : detail
        ? { raw: detail }
        : {};

    const serviceClient = createServiceClient();

    // 3. Insertar en security_events
    const { error: insertErr } = await (
      serviceClient.from("security_events") as any
    ).insert({
      client_id: clientId,
      event_type,
      ip: normalizedIp,
      detail: eventDetail,
    });

    if (insertErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR", message: "Error interno del servidor.",
          },
        },
        { status: 500 }
      );
    }

    // 4. Detección de patrones en el mismo flujo tras insertar
    if (normalizedIp) {
      await runSecurityDetection(serviceClient, clientId, normalizedIp);
    }

    // 5. Responder 201 { ok: true }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
