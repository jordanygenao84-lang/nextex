import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/[id]/endpoints
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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

    const canRead = await defaultPermissionEngine.can(user.id, integ.workspace_id, "integrations.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { data: endpoints, error } = await (supabase.from("integration_endpoints") as any)
      .select("*")
      .eq("integration_id", params.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ endpoints: endpoints || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * POST /api/integrations/[id]/endpoints
 * Registra un nuevo endpoint y entrega el secreto HMAC en texto plano por única vez.
 */
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

    const canCreate = await defaultPermissionEngine.can(user.id, integ.workspace_id, "integrations.create", { supabaseClient: supabase });
    if (!canCreate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canCreate.reason, statusCode: 403 } }, { status: 403 });
    }

    const body = await req.json();
    const { name, eventTypes, verificationMethod, replayWindowSeconds, maxPayloadBytes } = body;

    if (!name) {
      return NextResponse.json({ error: { code: "INVALID_PARAMETERS", message: "name es un campo obligatorio.", statusCode: 400 } }, { status: 400 });
    }

    const result = await defaultIntegrationEngine.createEndpoint(
      params.id,
      integ.workspace_id,
      {
        name,
        event_types: eventTypes,
        verification_method: verificationMethod,
        replay_window_seconds: replayWindowSeconds,
        max_payload_bytes: maxPayloadBytes,
      },
      supabase
    );

    // plainSecret se entrega exclusivamente aquí para visualización única en frontend
    return NextResponse.json({ endpoint: result.endpoint, plainSecret: result.plainSecret }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
