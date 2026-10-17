import { NextRequest, NextResponse } from "next/server";
import { verifyFleetAgent } from "@/lib/fleet/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const verified = await verifyFleetAgent(req);
    if (!verified) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Clave X-Fleet-Key inválida o ausente." } },
        { status: 401 }
      );
    }

    const { agent, supabase } = verified;
    const jobId = params.id;

    const { data: job, error: jobError } = await (supabase.from("fleet_jobs") as any)
      .select("id, status, agent_id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job || job.status !== "running" || job.agent_id !== agent.id) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Trabajo no encontrado, inactivo o perteneciente a otro agente." } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const vus = typeof body.vus === "number" ? body.vus : Number(body.vus) || 0;
    const rps = typeof body.rps === "number" ? body.rps : Number(body.rps) || 0;
    const p50_ms = body.p50_ms != null ? Number(body.p50_ms) : null;
    const p95_ms = body.p95_ms != null ? Number(body.p95_ms) : null;
    const p99_ms = body.p99_ms != null ? Number(body.p99_ms) : null;
    const errorsCount = typeof body.errors === "number" ? body.errors : Number(body.errors) || 0;

    const { data: metric, error: insertError } = await (supabase.from("fleet_metrics") as any)
      .insert({
        job_id: jobId,
        vus,
        rps,
        p50_ms,
        p95_ms,
        p99_ms,
        errors: errorsCount,
        ts: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: insertError.message } }, { status: 500 });
    }

    await (supabase.from("fleet_agents") as any)
      .update({ last_seen_at: new Date().toISOString(), status: "busy" })
      .eq("id", agent.id);

    return NextResponse.json({ ok: true, metric }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al registrar métricas." } },
      { status: 500 }
    );
  }
}
