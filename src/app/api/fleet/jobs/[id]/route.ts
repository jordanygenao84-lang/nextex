import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const serviceClient = createServiceClient();
    const jobId = params.id;

    const { data: job, error: jobError } = await (serviceClient.from("fleet_jobs") as any)
      .select("*, fleet_agents(id, name, status, last_seen_at)")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Trabajo no encontrado." } }, { status: 404 });
    }

    // Consultar las últimas 200 métricas ordenadas ascendentemente por timestamp
    const { data: metricsDesc, error: metricsError } = await (serviceClient.from("fleet_metrics") as any)
      .select("*")
      .eq("job_id", jobId)
      .order("ts", { ascending: false })
      .limit(200);

    if (metricsError) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: metricsError.message } }, { status: 500 });
    }

    const metricsAsc = (metricsDesc || []).reverse();

    return NextResponse.json({
      job: {
        ...job,
        agent_name: job.fleet_agents?.name || null,
      },
      metrics: metricsAsc,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al obtener detalle del trabajo." } },
      { status: 500 }
    );
  }
}
