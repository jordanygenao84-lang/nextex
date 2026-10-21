import { SupabaseClient } from "@supabase/supabase-js";
import { sendVigiaAlert } from "@/lib/vigia/notify";

/**
 * NEXTEХ VIGÍA — Motor de Detección de Ataques (VIG-4 & VIG-6)
 * Analiza eventos de seguridad en ventanas de tiempo para detectar:
 * 1. Fuerza bruta: ≥20 failed_login de una IP en 10 min.
 * 2. Pico de autenticación: ≥100 eventos totales de una IP en 10 min.
 *
 * Crea security_findings, incident_log y dispara alertas Telegram evitando duplicados abiertos en la última hora.
 */
export async function runSecurityDetection(
  supabase: SupabaseClient,
  clientId: string,
  ip: string
): Promise<void> {
  if (!ip || !clientId) return;

  const normalizedIp = ip.trim();
  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  try {
    // -------------------------------------------------------------
    // Patrón 1: Ataque de Fuerza Bruta (≥20 failed_login en 10 min)
    // -------------------------------------------------------------
    const { count: failedLoginCount } = await (supabase.from("security_events") as any)
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("ip", normalizedIp)
      .eq("event_type", "failed_login")
      .gte("created_at", tenMinutesAgo);

    const failedCount = failedLoginCount ?? 0;
    if (failedCount >= 20) {
      // Verificar si ya existe un finding abierto tipo brute_force en la última hora
      const { data: existingFindings } = await (supabase.from("security_findings") as any)
        .select("id, evidence")
        .eq("client_id", clientId)
        .eq("type", "brute_force")
        .eq("status", "open")
        .gte("created_at", oneHourAgo);

      const alreadyReported =
        Array.isArray(existingFindings) &&
        existingFindings.some((f: any) => f.evidence?.ip === normalizedIp);

      if (!alreadyReported) {
        const evidence = {
          ip: normalizedIp,
          count: failedCount,
          ventana_min: 10,
        };
        const title = "Posible ataque de fuerza bruta";

        const { data: newFinding, error: findingErr } = await (
          supabase.from("security_findings") as any
        )
          .insert({
            client_id: clientId,
            source: "detection",
            type: "brute_force",
            severity: "critical",
            title,
            evidence,
            status: "open",
          })
          .select("id")
          .single();

        if (!findingErr && newFinding) {
          await (supabase.from("incident_log") as any).insert({
            client_id: clientId,
            kind: "attack_detected",
            title: `Ataque detectado: ${title} (IP ${normalizedIp})`,
            detail: {
              source: "detection",
              type: "brute_force",
              severity: "critical",
              finding_id: newFinding.id,
              evidence,
            },
          });

          // VIG-6: Alerta Telegram para fuerza bruta
          let clientName = "Cliente";
          try {
            const { data: clientRow } = await (supabase.from("clients") as any)
              .select("display_name")
              .eq("id", clientId)
              .maybeSingle();
            if (clientRow?.display_name) clientName = clientRow.display_name;
          } catch {}

          await sendVigiaAlert(
            `🛡️ Posible fuerza bruta en ${clientName} — IP ${normalizedIp}, ${failedCount} intentos`,
            `Se detectaron ${failedCount} intentos fallidos de inicio de sesión desde la IP ${normalizedIp} en los últimos 10 minutos.`,
            { clientId, kind: "attack_detected" },
            supabase
          );
        }
      }
    }

    // -----------------------------------------------------------------
    // Patrón 2: Pico de Autenticación (≥100 eventos de cualquier tipo)
    // -----------------------------------------------------------------
    const { count: allEventsCount } = await (supabase.from("security_events") as any)
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("ip", normalizedIp)
      .gte("created_at", tenMinutesAgo);

    const totalCount = allEventsCount ?? 0;
    if (totalCount >= 100) {
      // Verificar si ya existe un finding abierto tipo auth_spike en la última hora
      const { data: existingSpikes } = await (supabase.from("security_findings") as any)
        .select("id, evidence")
        .eq("client_id", clientId)
        .eq("type", "auth_spike")
        .eq("status", "open")
        .gte("created_at", oneHourAgo);

      const alreadySpike =
        Array.isArray(existingSpikes) &&
        existingSpikes.some((f: any) => f.evidence?.ip === normalizedIp);

      if (!alreadySpike) {
        const evidence = {
          ip: normalizedIp,
          count: totalCount,
          ventana_min: 10,
        };
        const title = "Pico de autenticación anómalo";

        const { data: newFinding, error: spikeErr } = await (
          supabase.from("security_findings") as any
        )
          .insert({
            client_id: clientId,
            source: "detection",
            type: "auth_spike",
            severity: "warning",
            title,
            evidence,
            status: "open",
          })
          .select("id")
          .single();

        if (!spikeErr && newFinding) {
          await (supabase.from("incident_log") as any).insert({
            client_id: clientId,
            kind: "attack_detected",
            title: `Ataque detectado: ${title} (IP ${normalizedIp})`,
            detail: {
              source: "detection",
              type: "auth_spike",
              severity: "warning",
              finding_id: newFinding.id,
              evidence,
            },
          });
        }
      }
    }
  } catch (err: any) {
    console.error("Error en runSecurityDetection:", err?.message || err);
  }
}
