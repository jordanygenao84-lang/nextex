import { NextRequest, NextResponse } from "next/server";
import { verifyFleetAgent } from "@/lib/fleet/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const verified = await verifyFleetAgent(req);
    if (!verified) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Clave X-Fleet-Key inválida o ausente." } },
        { status: 401 }
      );
    }

    const { agent, supabase } = verified;
    const nowIso = new Date().toISOString();

    await (supabase.from("fleet_agents") as any)
      .update({ last_seen_at: nowIso, status: "online" })
      .eq("id", agent.id);

    const { data: candidates, error: searchError } = await (supabase.from("fleet_jobs") as any)
      .select("id, agent_id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(20);

    if (searchError) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: searchError.message } }, { status: 500 });
    }

    const eligible = (candidates || []).filter(
      (c: any) => !c.agent_id || c.agent_id === agent.id
    );

    if (eligible.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    for (const cand of eligible) {
      const { data: claimedJob, error: claimError } = await (supabase.from("fleet_jobs") as any)
        .update({ status: "running", started_at: nowIso, agent_id: agent.id })
        .eq("id", cand.id)
        .eq("status", "queued")
        .select("id, name, target_url, vus, duration_seconds, rampup_seconds, scenario")
        .maybeSingle();

      if (!claimError && claimedJob) {
        return NextResponse.json(claimedJob);
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
