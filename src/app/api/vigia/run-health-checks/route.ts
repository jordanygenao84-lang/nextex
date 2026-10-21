/**
 * NEXTEХ VIGÍA — Endpoint Interno: Ejecución de Chequeos de Salud (VIG-2)
 *
 * Endpoint interno protegido para ejecución periódica de monitoreo web.
 * Requiere encabezado: Authorization: Bearer <CRON_SECRET> o x-cron-secret
 *
 * Configuración recomendada en pg_cron (Supabase SQL Editor):
 * select cron.schedule('vigia-health-checks', '* * * * *', $$
 *   select net.http_post(
 *     url := 'https://nextex-seven.vercel.app/api/vigia/run-health-checks',
 *     headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>')
 *   );
 * $$);
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { executeVigiaHealthChecks } from "@/lib/vigia/health";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Valida el token de autorización interno contra process.env.CRON_SECRET.
 */
function validateInternalSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  // Soporta Authorization: Bearer <token> o x-cron-secret / x-internal-secret
  let providedToken: string | null = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.substring(7).trim();
  } else {
    providedToken = req.headers.get("x-cron-secret") || req.headers.get("x-internal-secret");
  }

  if (!providedToken) {
    return false;
  }

  try {
    const tokenBuf = Buffer.from(providedToken);
    const secretBuf = Buffer.from(secret);

    if (tokenBuf.length !== secretBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(tokenBuf, secretBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verificación de seguridad interna (401 si no tiene el header válido)
    if (!validateInternalSecret(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid internal secret" },
        { status: 401 }
      );
    }

    // 2. Ejecutar motor de chequeos de salud
    const serviceClient = createServiceClient();
    const result = await executeVigiaHealthChecks(serviceClient);

    // 3. Responder resultado (incluyendo { skipped: true } ante debounce de 5 min)
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Error al ejecutar chequeos de salud de VIGÍA." },
      { status: 500 }
    );
  }
}

/** Vercel Cron puede despachar en GET */
export async function GET(req: NextRequest) {
  return POST(req);
}
