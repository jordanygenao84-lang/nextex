import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: integ } = await (supabase.from("integrations") as any).select("workspace_id").eq("id", params.id).single();
    if (!integ) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });

    const canPause = await defaultPermissionEngine.can(user.id, integ.workspace_id, "integrations.pause", { supabaseClient: supabase });
    if (!canPause.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canPause.reason, statusCode: 403 } }, { status: 403 });
    }

    const updated = await defaultIntegrationEngine.setIntegrationStatus(params.id, integ.workspace_id, "paused", supabase);
    return NextResponse.json({ integration: updated });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
