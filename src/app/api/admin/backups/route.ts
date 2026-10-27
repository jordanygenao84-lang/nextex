import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backups
 * Lista el estado de respaldos por cliente (configuración higienizada, última corrida)
 * y el historial reciente de backup_runs (NIV1-5).
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

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Obtener todos los clientes
    const { data: clients, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id, display_name")
      .order("display_name", { ascending: true });

    if (clientErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: clientErr.message } },
        { status: 500 }
      );
    }

    // 2. Obtener configuraciones de respaldo
    const { data: configs, error: configErr } = await (serviceClient.from("backup_configs") as any)
      .select("*");

    if (configErr) {
      console.warn("[BACKUPS] Error al consultar backup_configs:", configErr);
    }

    // Mapeo seguro: JAMÁS exponer llaves descifradas ni cifradas
    const configMap = new Map<string, any>();
    (configs || []).forEach((c: any) => {
      configMap.set(c.client_id, {
        client_id: c.client_id,
        supabase_url: c.supabase_url || null,
        github_repo: c.github_repo || null,
        github_branch: c.github_branch || "main",
        enabled: Boolean(c.enabled),
        has_service_key: Boolean(c.service_key_encrypted),
        has_github_token: Boolean(c.github_token_encrypted),
        created_at: c.created_at,
        updated_at: c.updated_at,
      });
    });

    // 3. Obtener historial reciente de corridas
    const { data: recentRuns, error: runsErr } = await (serviceClient.from("backup_runs") as any)
      .select(`
        id,
        client_id,
        kind,
        status,
        location,
        size_bytes,
        detail,
        created_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (runsErr) {
      console.warn("[BACKUPS] Error al consultar backup_runs:", runsErr);
    }

    const runsList = Array.isArray(recentRuns) ? recentRuns : [];

    // 4. Armar resumen por cliente. La última corrida se consulta POR CLIENTE:
    // el listado global tiene límite 50 y un cliente con muchas corridas
    // recientes (p. ej. NEXCREDIT fallando cada minuto) dejaba fuera las
    // corridas más viejas de los demás y su badge quedaba en "Sin respaldos
    // aún" aunque tuviera respaldos ok.
    const clientList = await Promise.all(
      (clients || []).map(async (client: any) => {
        const config = configMap.get(client.id) || null;
        const { data: latestRun } = await (serviceClient.from("backup_runs") as any)
          .select(
            `id, client_id, kind, status, location, size_bytes, detail, created_at,
             client:clients (id, display_name)`
          )
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          id: client.id,
          display_name: client.display_name,
          config,
          latest_run: latestRun || null,
        };
      })
    );

    return NextResponse.json({
      clients: clientList,
      recent_runs: runsList,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Error al obtener estado de respaldos.",
        },
      },
      { status: 500 }
    );
  }
}
