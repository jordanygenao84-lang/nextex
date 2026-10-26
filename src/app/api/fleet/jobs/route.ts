import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isDomainAllowed } from "@/lib/fleet/allowlist";
import { getUserWorkspaces, isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const allowedWorkspaces = await getUserWorkspaces(user.id);
      if (allowedWorkspaces.length === 0) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Recurso no encontrado." } },
          { status: 404 }
        );
      }
    }

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("fleet_jobs") as any)
      .select("*, fleet_agents(id, name)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!superAdmin) {
      query = query.eq("created_by", user.id);
    }

    const { data: jobs, error } = await query;

    if (error) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
    }

    const formattedJobs = (jobs || []).map((j: any) => ({
      ...j,
      agent_name: j.fleet_agents?.name || null,
    }));

    return NextResponse.json({ jobs: formattedJobs });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar trabajos." } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const allowedWorkspaces = await getUserWorkspaces(user.id);
      if (allowedWorkspaces.length === 0) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Recurso no encontrado." } },
          { status: 404 }
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    const { name, target_url, vus, duration_seconds, rampup_seconds, scenario, agent_id } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: { message: "El campo 'name' es obligatorio." } }, { status: 400 });
    }

    if (!target_url || typeof target_url !== "string" || !target_url.trim()) {
      return NextResponse.json({ error: { message: "El campo 'target_url' es obligatorio." } }, { status: 400 });
    }

    const vusNum = Number(vus);
    if (!Number.isInteger(vusNum) || vusNum <= 0 || vusNum > 100000) {
      return NextResponse.json({ error: { message: "vus debe ser un entero entre 1 y 100000." } }, { status: 400 });
    }

    const durationNum = Number(duration_seconds);
    if (!Number.isInteger(durationNum) || durationNum <= 0 || durationNum > 3600) {
      return NextResponse.json({ error: { message: "duration_seconds debe ser un entero entre 1 y 3600." } }, { status: 400 });
    }

    const rampupNum = rampup_seconds !== undefined ? Number(rampup_seconds) : 60;
    if (isNaN(rampupNum) || rampupNum < 0) {
      return NextResponse.json({ error: { message: "rampup_seconds inválido." } }, { status: 400 });
    }

    // VALIDACIÓN OBLIGATORIA: target_url contra allowlist
    const allowCheck = isDomainAllowed(target_url.trim());
    if (!allowCheck.allowed) {
      return NextResponse.json(
        { error: { code: "DOMAIN_NOT_ALLOWED", message: allowCheck.reason || "dominio no autorizado" } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // Si se especifica un agente, validar que no exceda su max_vus
    if (agent_id) {
      const { data: agent, error: agentErr } = await (serviceClient.from("fleet_agents") as any)
        .select("capabilities")
        .eq("id", agent_id)
        .maybeSingle();

      if (agentErr || !agent) {
        return NextResponse.json({ error: { message: "El agente especificado no existe." } }, { status: 400 });
      }

      const maxVus = Number(agent.capabilities?.max_vus) || 5000;
      if (vusNum > maxVus) {
        return NextResponse.json(
          { error: { message: `vus (${vusNum}) excede la capacidad máxima del agente (${maxVus}).` } },
          { status: 400 }
        );
      }
    }

    const { data: newJob, error: insertError } = await (serviceClient.from("fleet_jobs") as any)
      .insert({
        name: name.trim(),
        target_url: target_url.trim(),
        vus: vusNum,
        duration_seconds: durationNum,
        rampup_seconds: rampupNum,
        scenario: typeof scenario === "object" && scenario !== null ? scenario : {},
        agent_id: agent_id || null,
        status: "queued",
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError || !newJob) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertError?.message || "No se pudo encolar el trabajo." } },
        { status: 500 }
      );
    }

    return NextResponse.json({ job: newJob }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al crear trabajo de prueba." } },
      { status: 500 }
    );
  }
}
