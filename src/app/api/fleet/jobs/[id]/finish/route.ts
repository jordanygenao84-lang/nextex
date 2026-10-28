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
    const body = await req.json().catch(() => ({}));
    const finalStatus = body?.error ? "failed" : "completed";
    const nowIso = new Date().toISOString();

    const { data: updatedJob, error: updateError } = await (supabase.from("fleet_jobs") as any)
      .update({
        status: finalStatus,
        finished_at: nowIso,
        summary: body?.summary ?? null,
        error: body?.error ? String(body.error) : null,
      })
      .eq("id", jobId)
      .eq("agent_id", agent.id)
      .select()
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: updateError.message } }, { status: 500 });
    }

    if (!updatedJob) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "El trabajo no fue encontrado o no está asignado a este agente." } },
        { status: 404 }
      );
    }

    await (supabase.from("fleet_agents") as any)
      .update({ status: "online", last_seen_at: nowIso })
      .eq("id", agent.id);

    return NextResponse.json({ ok: true, job: updatedJob, status: finalStatus });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
