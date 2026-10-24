import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultEpisodicWorker } from "@/lib/jobs/worker/worker";
import { executeVigiaHealthChecks } from "@/lib/vigia/health";
import { executeVigiaSecurityScans } from "@/lib/vigia/scan";
import { checkCredentialExpirations } from "@/lib/protection/credentials";
import { executeScheduledBackups } from "@/lib/protection/backups";
import { processSubscriptions } from "@/lib/billing/subscriptions";
import { executeDomainChecks } from "@/lib/domains/check";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/worker/tick
 * Endpoint interno para ejecución episódica serverless del worker, vigilancia de salud VIGÍA
 * y chequeo de vencimiento de credenciales (NIV1-2).
 * Requiere encabezado: Authorization: Bearer <CRON_SECRET>
 *
 * Configuración alternativa directa en pg_cron (Supabase SQL Editor):
 * select cron.schedule('vigia-health-checks', '* * * * *', $$
 *   select net.http_post(
 *     url := 'https://nextex-seven.vercel.app/api/vigia/run-health-checks',
 *     headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>')
 *   );
 * $$);
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing Bearer token" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return NextResponse.json({ error: "Server Configuration Error: CRON_SECRET not configured" }, { status: 500 });
    }

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return NextResponse.json({ error: "Forbidden: Invalid authorization token" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const result = await defaultEpisodicWorker.executeTick(supabase);

    // VIG-2: Ejecución automática de VIGÍA.
    // La puerta interna de 5 minutos evita chequeos redundantes en ticks minuto a minuto.
    let vigiaHealth: any = null;
    try {
      vigiaHealth = await executeVigiaHealthChecks(supabase);
    } catch (vErr) {
      console.error("[VIGÍA] Error en chequeo de salud durante tick:", vErr);
    }

    // VIG-5: Escaneo periódico de seguridad de VIGÍA.
    // La puerta interna de 24 horas por cliente regula la cadencia real.
    let vigiaScans: any = null;
    try {
      vigiaScans = await executeVigiaSecurityScans(supabase);
    } catch (sErr) {
      console.error("[VIGÍA] Error en escaneo de seguridad durante tick:", sErr);
    }

    // NIV1-2: Chequeo de vencimientos de credenciales.
    // Sin puerta de tiempo: el dedup por incident_log evita el spam.
    let credentialsCheck: any = null;
    try {
      credentialsCheck = await checkCredentialExpirations(supabase);
    } catch (cErr) {
      console.error("[PROTECCIÓN] Error en chequeo de credenciales durante tick:", cErr);
    }

    // NIV1-5: Respaldos automáticos cada 6 días por cliente configurado
    let scheduledBackups: any = null;
    try {
      scheduledBackups = await executeScheduledBackups(supabase);
    } catch (bErr) {
      console.error("[PROTECCIÓN] Error en respaldos programados durante tick:", bErr);
    }

    // NIV2-1: Motor de suscripciones y cobro recurrente (facturación, mora, suspensión, reactivación)
    let subscriptionsResult: any = null;
    try {
      subscriptionsResult = await processSubscriptions(supabase);
    } catch (subErr) {
      console.error("[BILLING] Error en procesamiento de suscripciones durante tick:", subErr);
    }

    // NIV2-5: Verificación de dominios/DNS (puerta 24h) y alertas de vencimiento
    let domainsResult: any = null;
    try {
      domainsResult = await executeDomainChecks(supabase);
    } catch (domErr) {
      console.error("[DOMAINS] Error en chequeo de dominios durante tick:", domErr);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result,
      vigia_health: vigiaHealth,
      vigia_scans: vigiaScans,
      credentials_check: credentialsCheck,
      scheduled_backups: scheduledBackups,
      subscriptions: subscriptionsResult,
      domains: domainsResult,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal Worker Error" }, { status: 500 });
  }
}

/** Vercel Cron dispatches scheduled invocations as GET requests. */
export async function GET(req: NextRequest) {
  return POST(req);
}
