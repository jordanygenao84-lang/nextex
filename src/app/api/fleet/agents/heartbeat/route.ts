import { NextRequest, NextResponse } from "next/server";
import { verifyFleetAgent } from "@/lib/fleet/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const verified = await verifyFleetAgent(req);
    if (!verified) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Clave X-Fleet-Key inválida o ausente." } },
        { status: 401 }
      );
    }

    const { agent, supabase } = verified;
    const body = await req.json().catch(() => ({}));
    const newStatus = typeof body?.status === "string" && body.status.trim() ? body.status.trim() : "online";

    const { error } = await (supabase.from("fleet_agents") as any)
      .update({
        status: newStatus,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", agent.id);

    if (error) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al procesar heartbeat." } },
      { status: 500 }
    );
  }
}
