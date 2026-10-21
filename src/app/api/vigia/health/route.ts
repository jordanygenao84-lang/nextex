import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/vigia/health
 * Retorna el estado de salud más reciente y el conteo de incidentes sin resolver
 * para todos los clientes activos.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    // 1. Verificación de superadministrador (reusando helper de roles)
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();

    // 2. Obtener clientes activos
    const { data: clients, error: clientsErr } = await (serviceClient.from("clients") as any)
      .select("id, display_name, website_url")
      .eq("status", "active")
      .order("display_name", { ascending: true });

    if (clientsErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: clientsErr.message } },
        { status: 500 }
      );
    }

    if (!Array.isArray(clients) || clients.length === 0) {
      return NextResponse.json([]);
    }

    // 3. Consultar último chequeo e incidentes para cada cliente
    const results = await Promise.all(
      clients.map(async (client) => {
        // Último chequeo de salud
        const { data: latestCheck } = await (serviceClient.from("site_health_checks") as any)
          .select("status, response_ms, ssl_days_left, checked_at")
          .eq("client_id", client.id)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Incidentes para determinar los no resueltos (health_down sin health_recovered posterior)
        const { data: incidents } = await (serviceClient.from("incident_log") as any)
          .select("kind, created_at")
          .eq("client_id", client.id)
          .in("kind", ["health_down", "health_recovered"])
          .order("created_at", { ascending: false });

        let latestRecoveredAt: string | null = null;
        if (Array.isArray(incidents)) {
          const recoveredItem = incidents.find((inc: any) => inc.kind === "health_recovered");
          if (recoveredItem) {
            latestRecoveredAt = recoveredItem.created_at;
          }
        }

        let unresolvedCount = 0;
        if (Array.isArray(incidents)) {
          for (const inc of incidents) {
            if (inc.kind === "health_down") {
              if (!latestRecoveredAt || inc.created_at > latestRecoveredAt) {
                unresolvedCount++;
              }
            }
          }
        }

        return {
          client_id: client.id,
          display_name: client.display_name,
          website_url: client.website_url,
          latest_check: latestCheck
            ? {
                status: latestCheck.status,
                response_ms: latestCheck.response_ms,
                ssl_days_left: latestCheck.ssl_days_left,
                checked_at: latestCheck.checked_at,
              }
            : null,
          unresolved_incidents: unresolvedCount,
        };
      })
    );

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al obtener estado de salud de clientes.",
        },
      },
      { status: 500 }
    );
  }
}
