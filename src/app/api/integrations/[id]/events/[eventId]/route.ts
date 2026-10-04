import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/[id]/events/[eventId]
 * Detalle completo de un evento con su historial de intentos de ejecución y auditoría.
 */
export async function GET(
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

    const { data: event, error } = await (supabase.from("integration_events") as any)
      .select("*, integration_event_attempts(*), job_runs(id, status, attempt, max_attempts, created_at)")
      .eq("id", params.eventId)
      .eq("integration_id", params.id)
      .single();

    if (error || !event) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Evento no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, event.workspace_id, "integration_events.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    // Sanitizar cualquier secreto accidental en headers_metadata
    const sanitizedHeaders: Record<string, any> = { ...event.headers_metadata };
    delete sanitizedHeaders["authorization"];
    delete sanitizedHeaders["cookie"];
    delete sanitizedHeaders["x-api-key"];

    return NextResponse.json({
      event: {
        ...event,
        headers_metadata: sanitizedHeaders,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
