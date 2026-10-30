/**
 * NEXTEХ VIGÍA — Motor de Autodiagnóstico Interno (Selfcheck)
 * Ejecuta comprobaciones internas de salud, infraestructura, observabilidad y seguridad.
 * Abre y cierra hallazgos en security_findings (source = 'selfcheck') e inserta incident_log.
 *
 * Restricciones:
 * - Operaciones estrictamente de LECTURA sobre los componentes auditados.
 * - NUNCA escribe en tablas de negocio.
 * - NUNCA inscribe, verifica ni elimina factores MFA (solo lectura vía GoTrue Admin API).
 * - NUNCA copia valores sensibles a evidence (únicamente conteos, estados y fingerprints).
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { calculateErrorFingerprint } from "@/lib/protection/errors";

export interface SelfCheckResult {
  skipped?: boolean;
  reason?: string;
  timestamp?: string;
  checks_evaluated?: number;
  conditions_detected?: number;
  new_findings?: number;
  closed_findings?: number;
  duration_ms?: number;
  findings?: Array<{
    type: string;
    severity: string;
    title: string;
  }>;
}

interface SelfCheckFindingDefinition {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  evidence: Record<string, any>;
  fix_prompt: string;
}

/**
 * Resuelve el ID del cliente representativo de NEXTEX en la tabla `clients`.
 * Prioriza un cliente cuyo nombre contenga 'nextex'; si no existe, toma el primer cliente de la plataforma.
 */
async function getNextexClientId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data: nextexClient } = await (supabase.from("clients") as any)
      .select("id")
      .ilike("display_name", "%nextex%")
      .limit(1)
      .maybeSingle();

    if (nextexClient?.id) {
      return nextexClient.id;
    }

    const { data: firstClient } = await (supabase.from("clients") as any)
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return firstClient?.id || null;
  } catch {
    return null;
  }
}

/**
 * Ejecuta las comprobaciones de autodiagnóstico del sistema NEXTEX.
 */
export async function executeSelfChecks(
  supabase: SupabaseClient,
  options?: { force?: boolean }
): Promise<SelfCheckResult> {
  const startTime = Date.now();

  // 1. Puerta interna de 15 minutos consultando el último incident_log (kind = 'selfcheck_completed')
  if (!options?.force) {
    try {
      const { data: latestCheck } = await (supabase.from("incident_log") as any)
        .select("created_at")
        .eq("kind", "selfcheck_completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestCheck?.created_at) {
        const diffMs = Date.now() - new Date(latestCheck.created_at).getTime();
        if (diffMs < 15 * 60 * 1000) {
          return {
            skipped: true,
            reason: "Puerta interna de 15 min activa (autodiagnóstico reciente)",
          };
        }
      }
    } catch (doorErr) {
      console.warn("[SELFCHECK] Aviso al evaluar puerta interna de 15m:", doorErr);
    }
  }

  const nextexClientId = await getNextexClientId(supabase);
  if (!nextexClientId) {
    return {
      skipped: true,
      reason: "No se encontró cliente en la tabla clients para vincular hallazgos",
    };
  }

  const detectedFindings = new Map<string, SelfCheckFindingDefinition>();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ---------------------------------------------------------------------------
  // Check 1: GET /api/health interno
  // ---------------------------------------------------------------------------
  try {
    const isDev = process.env.NODE_ENV === "development";
    let appUrl: string;

    if (isDev) {
      appUrl = (
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        "http://localhost:3000"
      ).trim();
    } else {
      const vercelUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL.trim()}`
        : null;
      appUrl = (
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        vercelUrl ||
        "https://nextex-seven.vercel.app"
      ).trim();

      if (appUrl.includes("localhost") || appUrl.includes("127.0.0.1")) {
        appUrl = vercelUrl || "https://nextex-seven.vercel.app";
      }
    }

    appUrl = appUrl.replace(/\/+$/, "");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const healthRes = await fetch(`${appUrl}/api/health`, {
      method: "GET",
      headers: { "User-Agent": "nextex-vigia-selfcheck/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const healthData = await healthRes.json().catch(() => null);

    if (!healthRes.ok || healthData?.status !== "ok") {
      detectedFindings.set("health_endpoint_failing", {
        type: "health_endpoint_failing",
        severity: "critical",
        title: "Fallo en endpoint interno de salud /api/health",
        evidence: {
          endpoint: "/api/health",
          http_status: healthRes.status,
          response_ok: healthRes.ok,
        },
        fix_prompt:
          "El endpoint interno /api/health no devolvió estado 200 OK. Inspecciona el servidor web Next.js y los procesos en ejecución.",
      });
    }
  } catch (hErr: any) {
    detectedFindings.set("health_endpoint_failing", {
      type: "health_endpoint_failing",
      severity: "critical",
      title: "Fallo en endpoint interno de salud /api/health",
      evidence: {
        endpoint: "/api/health",
        error_type: hErr?.name || "FetchError",
        unreachable: true,
      },
      fix_prompt:
        "No se pudo conectar con el endpoint interno /api/health. Verifica la conectividad local y los logs de la aplicación.",
    });
  }

  // ---------------------------------------------------------------------------
  // Check 2: Ping a BD con select id en workspaces con count exact head
  // ---------------------------------------------------------------------------
  try {
    const { error: dbPingError } = await (supabase.from("workspaces") as any)
      .select("id", { count: "exact", head: true });

    if (dbPingError) {
      detectedFindings.set("database_ping_failing", {
        type: "database_ping_failing",
        severity: "critical",
        title: "Fallo en ping de base de datos (SELECT en workspaces)",
        evidence: {
          table: "workspaces",
          ping_ok: false,
          error_code: dbPingError.code || "DB_ERROR",
        },
        fix_prompt:
          "El ping a la base de datos (SELECT id FROM workspaces con head: true) falló. Verifica la conectividad con Supabase PostgreSQL y las credenciales del service_role.",
      });
    }
  } catch (pingErr: any) {
    detectedFindings.set("database_ping_failing", {
      type: "database_ping_failing",
      severity: "critical",
      title: "Fallo en ping de base de datos (SELECT en workspaces)",
      evidence: {
        table: "workspaces",
        ping_ok: false,
        error_type: pingErr?.name || "Exception",
      },
      fix_prompt:
        "Excepción ejecutando ping a la base de datos. Verifica la red y disponibilidad del cluster PostgreSQL.",
    });
  }

  // ---------------------------------------------------------------------------
  // Check 3: Conteo de job_runs con status failed/dead_letter en 24 h
  // ---------------------------------------------------------------------------
  try {
    const { count: failedJobsCount, error: jobsErr } = await (
      supabase.from("job_runs") as any
    )
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "dead_letter"])
      .gte("created_at", twentyFourHoursAgo);

    if (!jobsErr && typeof failedJobsCount === "number" && failedJobsCount > 0) {
      detectedFindings.set("job_runs_failed_or_dead_letter", {
        type: "job_runs_failed_or_dead_letter",
        severity: "warning",
        title: "Trabajos de worker fallidos o en dead letter en las últimas 24h",
        evidence: {
          failed_job_runs_count: failedJobsCount,
          window_hours: 24,
        },
        fix_prompt: `Se registraron ${failedJobsCount} ejecuciones de jobs en estado 'failed' o 'dead_letter' en las últimas 24h. Revisa los errores y reintentos en /jobs.`,
      });
    }
  } catch (jobsEx: any) {
    console.warn("[SELFCHECK] Aviso al consultar job_runs:", jobsEx?.message || jobsEx);
  }

  // ---------------------------------------------------------------------------
  // Check 4: Conteo de observability_spans con started_at >= now() - 24h y tasa de failed
  // ---------------------------------------------------------------------------
  try {
    const [{ count: totalSpansCount }, { count: failedSpansCount }] = await Promise.all([
      (supabase.from("observability_spans") as any)
        .select("id", { count: "exact", head: true })
        .gte("started_at", twentyFourHoursAgo),
      (supabase.from("observability_spans") as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("started_at", twentyFourHoursAgo),
    ]);

    const totalSpans = totalSpansCount || 0;
    const failedSpans = failedSpansCount || 0;
    const failureRate = totalSpans > 0 ? failedSpans / totalSpans : 0;

    // Se dispara si hay trazas fallidas y la tasa supera el 5% o hay al menos 10 fallos
    if (failedSpans > 0 && (failureRate >= 0.05 || failedSpans >= 10)) {
      detectedFindings.set("high_observability_failure_rate", {
        type: "high_observability_failure_rate",
        severity: "warning",
        title: "Tasa elevada de fallos en trazas de observabilidad (últimas 24h)",
        evidence: {
          total_spans: totalSpans,
          failed_spans: failedSpans,
          failure_rate_percent: Number((failureRate * 100).toFixed(2)),
          window_hours: 24,
        },
        fix_prompt: `Se detectó una tasa de fallos de ${(failureRate * 100).toFixed(1)}% (${failedSpans} de ${totalSpans}) en las trazas de observabilidad en 24h. Revisa los componentes y llamadas a herramientas en /observability.`,
      });
    }
  } catch (obsEx: any) {
    console.warn("[SELFCHECK] Aviso al consultar observability_spans:", obsEx?.message || obsEx);
  }

  // ---------------------------------------------------------------------------
  // Check 5: Último backup_runs por cliente
  // ---------------------------------------------------------------------------
  try {
    const { data: configs } = await (supabase.from("backup_configs") as any)
      .select("client_id")
      .eq("enabled", true);

    if (Array.isArray(configs) && configs.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const affectedClients: string[] = [];

      for (const cfg of configs) {
        const { data: latestRun } = await (supabase.from("backup_runs") as any)
          .select("status, created_at")
          .eq("client_id", cfg.client_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          !latestRun ||
          latestRun.status === "failed" ||
          latestRun.created_at < sevenDaysAgo
        ) {
          affectedClients.push(cfg.client_id);
        }
      }

      if (affectedClients.length > 0) {
        detectedFindings.set("backup_runs_stale_or_failed", {
          type: "backup_runs_stale_or_failed",
          severity: "warning",
          title: "Respaldos satélite fallidos o desactualizados (>7 días)",
          evidence: {
            affected_clients_count: affectedClients.length,
            client_ids: affectedClients,
          },
          fix_prompt: `Se detectaron ${affectedClients.length} clientes con respaldo desactualizado o en fallo. Revisa la sección Respaldos en /admin/proteccion para ejecutar un respaldo manual.`,
        });
      }
    }
  } catch (bkEx: any) {
    console.warn("[SELFCHECK] Aviso al consultar backup_runs:", bkEx?.message || bkEx);
  }

  // ---------------------------------------------------------------------------
  // Check 6: error_events de 24h pasados por el sanitizador de src/lib/protection/errors.ts
  // ---------------------------------------------------------------------------
  try {
    const { data: errRows } = await (supabase.from("error_events") as any)
      .select("client_id, error_type, message, occurrences, last_seen_at")
      .gte("last_seen_at", twentyFourHoursAgo);

    if (Array.isArray(errRows) && errRows.length > 0) {
      let totalOccurrences = 0;
      const fingerprintsSet = new Set<string>();

      for (const row of errRows) {
        totalOccurrences += Number(row.occurrences) || 1;
        // Sanitizar y calcular fingerprint usando el helper de errores
        const fp = calculateErrorFingerprint(
          row.client_id,
          row.error_type,
          row.message || ""
        );
        fingerprintsSet.add(fp);
      }

      const distinctCount = fingerprintsSet.size;

      // Se dispara si hay un volumen recurrente significativo (≥25 ocurrencias o ≥10 grupos distintos)
      if (totalOccurrences >= 25 || distinctCount >= 10) {
        detectedFindings.set("recurring_sanitized_errors", {
          type: "recurring_sanitized_errors",
          severity: "warning",
          title: "Volumen elevado de errores reportados por webs satélite (24h)",
          evidence: {
            total_occurrences_24h: totalOccurrences,
            distinct_fingerprints_count: distinctCount,
            sample_fingerprints: Array.from(fingerprintsSet).slice(0, 5),
            window_hours: 24,
          },
          fix_prompt: `Se registraron ${totalOccurrences} ocurrencias de errores (${distinctCount} firmas distintas) en las últimas 24h. Revisa /admin/proteccion (Errores de las webs) para diagnosticar.`,
        });
      }
    }
  } catch (errEx: any) {
    console.warn("[SELFCHECK] Aviso al evaluar error_events:", errEx?.message || errEx);
  }

  // ---------------------------------------------------------------------------
  // Check 7: control_plane_audit_log con decision = 'deny' en 24 h
  // ---------------------------------------------------------------------------
  try {
    const { count: deniedCount } = await (
      supabase.from("control_plane_audit_log") as any
    )
      .select("id", { count: "exact", head: true })
      .eq("decision", "deny")
      .gte("created_at", twentyFourHoursAgo);

    if (typeof deniedCount === "number" && deniedCount > 0) {
      detectedFindings.set("control_plane_denied_actions", {
        type: "control_plane_denied_actions",
        severity: "warning",
        title: "Acciones denegadas (decision: deny) en el Control Plane en 24h",
        evidence: {
          denied_decisions_count: deniedCount,
          window_hours: 24,
        },
        fix_prompt: `El Control Plane bloqueó ${deniedCount} acciones con decisión 'deny' en las últimas 24h. Inspecciona los registros en /control-plane para descartar anomalías de gobernanza.`,
      });
    }
  } catch (cpEx: any) {
    console.warn("[SELFCHECK] Aviso al consultar control_plane_audit_log:", cpEx?.message || cpEx);
  }

  // ---------------------------------------------------------------------------
  // Check 8: Factores TOTP del super_admin vía GoTrue Admin API solo en lectura
  // ---------------------------------------------------------------------------
  try {
    const { data: superAdmins } = await (supabase.from("profiles") as any)
      .select("id")
      .eq("is_super_admin", true);

    if (Array.isArray(superAdmins) && superAdmins.length > 0) {
      let superAdminsWithoutTotp = 0;

      for (const admin of superAdmins) {
        try {
          const factorsRes = await supabase.auth.admin.mfa.listFactors({
            userId: admin.id,
          });

          const factors = factorsRes?.data?.factors;
          const hasVerifiedTotp =
            Array.isArray(factors) &&
            factors.some(
              (f: any) => f.factor_type === "totp" && f.status === "verified"
            );

          if (!hasVerifiedTotp) {
            superAdminsWithoutTotp++;
          }
        } catch {
          // Si GoTrue Admin API no responde temporalmente para un usuario, no alterar contador
        }
      }

      if (superAdminsWithoutTotp > 0) {
        detectedFindings.set("super_admin_totp_missing", {
          type: "super_admin_totp_missing",
          severity: "critical",
          title: "Superadministrador sin autenticación multifactor (MFA/TOTP) verificada",
          evidence: {
            super_admins_checked: superAdmins.length,
            super_admins_without_totp: superAdminsWithoutTotp,
          },
          fix_prompt:
            "Uno o más usuarios con rol super_admin no poseen un factor TOTP verificado. Configura MFA en tu cuenta para proteger el acceso administrativo a la plataforma.",
        });
      }
    }
  } catch (mfaEx: any) {
    console.warn("[SELFCHECK] Aviso al consultar factores MFA de super_admin:", mfaEx?.message || mfaEx);
  }

  // ---------------------------------------------------------------------------
  // Gestión de hallazgos en security_findings (source = 'selfcheck')
  // ---------------------------------------------------------------------------
  let newFindingsCount = 0;
  let closedFindingsCount = 0;

  // Consultar hallazgos de selfcheck abiertos actualmente
  const { data: openFindings } = await (
    supabase.from("security_findings") as any
  )
    .select("id, type, title, evidence")
    .eq("source", "selfcheck")
    .eq("status", "open");

  const openList = Array.isArray(openFindings) ? openFindings : [];
  const openTypes = new Set(openList.map((f: any) => f.type));

  // 1. Cerrar a fixed con resolved_at los abiertos cuya condición ya no se cumple
  for (const existing of openList) {
    if (!detectedFindings.has(existing.type)) {
      const nowIso = new Date().toISOString();
      await (supabase.from("security_findings") as any)
        .update({
          status: "fixed",
          resolved_at: nowIso,
        })
        .eq("id", existing.id);

      await (supabase.from("incident_log") as any).insert({
        client_id: nextexClientId,
        kind: "self_finding_fixed",
        title: `Hallazgo de autodiagnóstico resuelto: ${existing.title}`,
        detail: {
          source: "selfcheck",
          type: existing.type,
          finding_id: existing.id,
          resolved_at: nowIso,
        },
      });

      closedFindingsCount++;
    }
  }

  // 2. Insertar nuevos hallazgos solo si no hay uno open del mismo type
  const detectedList = Array.from(detectedFindings.values());
  for (const findingData of detectedList) {
    if (!openTypes.has(findingData.type)) {
      const { data: insertedFinding } = await (
        supabase.from("security_findings") as any
      )
        .insert({
          client_id: nextexClientId,
          source: "selfcheck",
          type: findingData.type,
          severity: findingData.severity,
          title: findingData.title,
          evidence: findingData.evidence,
          fix_prompt: findingData.fix_prompt,
          status: "open",
        })
        .select("id")
        .single();

      await (supabase.from("incident_log") as any).insert({
        client_id: nextexClientId,
        kind: "self_finding_opened",
        title: `Nuevo hallazgo de autodiagnóstico: ${findingData.title}`,
        detail: {
          source: "selfcheck",
          type: findingData.type,
          severity: findingData.severity,
          finding_id: insertedFinding?.id || null,
          evidence: findingData.evidence,
        },
      });

      newFindingsCount++;
    }
  }

  // ---------------------------------------------------------------------------
  // Registro final en incident_log (kind = 'selfcheck_completed')
  // ---------------------------------------------------------------------------
  const durationMs = Date.now() - startTime;
  await (supabase.from("incident_log") as any).insert({
    client_id: nextexClientId,
    kind: "selfcheck_completed",
    title: "Autodiagnóstico VIGÍA completado (selfcheck)",
    detail: {
      checks_evaluados: 8,
      condiciones_detectadas: detectedFindings.size,
      findings_nuevos: newFindingsCount,
      findings_cerrados: closedFindingsCount,
      duracion_ms: durationMs,
    },
  });

  return {
    skipped: false,
    timestamp: new Date().toISOString(),
    checks_evaluated: 8,
    conditions_detected: detectedFindings.size,
    new_findings: newFindingsCount,
    closed_findings: closedFindingsCount,
    duration_ms: durationMs,
    findings: detectedList.map((d) => ({
      type: d.type,
      severity: d.severity,
      title: d.title,
    })),
  };
}
