import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/[id]/events/[eventId]/retry
 * Reintento atómico de eventos fallidos (exclusivo para status = 'failed').
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; eventId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: event } = await (supabase.from("integration_events") as any)
      .select("id, workspace_id, status")
      .eq("id", params.eventId)
      .eq("integration_id", params.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Evento no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canRetry = await defaultPermissionEngine.can(user.id, event.workspace_id, "integration_events.retry", { supabaseClient: supabase });
    if (!canRetry.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRetry.reason, statusCode: 403 } }, { status: 403 });
    }

    if (event.status !== "failed") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_EVENT_STATE",
            message: `Solo eventos en estado 'failed' admiten reintento. Estado actual: '${event.status}'. Para eventos received/verified use reprocess.`,
            statusCode: 400,
          },
        },
        { status: 400 }
      );
    }

    const result = await defaultIntegrationEngine.retryEvent(params.eventId, supabase);

    if (!result.success) {
      return NextResponse.json(
        { error: { code: result.error_code, message: result.message, statusCode: 400 } },
        { status: 400 }
      );
    }

    return NextResponse.json({ result });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
