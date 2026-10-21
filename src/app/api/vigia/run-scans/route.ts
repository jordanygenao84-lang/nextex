/**
 * NEXTEХ VIGÍA — Endpoint Interno: Ejecución de Escaneos de Seguridad (VIG-5)
 *
 * Endpoint interno protegido para ejecución periódica de escaneo de seguridad.
 * Requiere encabezado: Authorization: Bearer <CRON_SECRET> o x-cron-secret / x-internal-secret.
 * Puerta de 24h por cliente: si su último 'scan_completed' ocurrió hace <24h, se omite.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { executeVigiaSecurityScans } from "@/lib/vigia/scan";
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
    // 1. Verificación de seguridad interna (401 sin header válido)
    if (!validateInternalSecret(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid internal secret" },
        { status: 401 }
      );
    }

    // 2. Ejecutar motor de escaneo de seguridad (con puerta de 24h activa)
    const serviceClient = createServiceClient();
    const result = await executeVigiaSecurityScans(serviceClient);

    // 3. Responde resumen requerido
    return NextResponse.json({
      scanned: result.scanned,
      new_findings: result.new_findings,
      closed_findings: result.closed_findings,
      details: result.details,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Error al ejecutar escaneos de seguridad de VIGÍA." },
      { status: 500 }
    );
  }
}

/** Vercel Cron puede despachar en GET */
export async function GET(req: NextRequest) {
  return POST(req);
}
