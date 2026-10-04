import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/[id]/endpoints/[endpointId]/rotate
 * Rota transaccionalmente las credenciales HMAC del endpoint (primary -> secondary).
 * Devuelve el nuevo plainSecret una sola vez para visualización en UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; endpointId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: integ } = await (supabase.from("integrations") as any)
      .select("workspace_id")
      .eq("id", params.id)
      .single();

    if (!integ) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });
    }

    const canUpdate = await defaultPermissionEngine.can(user.id, integ.workspace_id, "integrations.update", { supabaseClient: supabase });
    if (!canUpdate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canUpdate.reason, statusCode: 403 } }, { status: 403 });
    }

    let gracePeriodSeconds = 86400; // 24 horas por defecto
    try {
      const body = await req.json();
      if (body.grace_period_seconds && typeof body.grace_period_seconds === "number") {
        gracePeriodSeconds = body.grace_period_seconds;
      }
    } catch {
      // Body opcional
    }

    // Ejecuta RPC rotate_integration_endpoint_secret bajo service_role tras validar JIT en Next.js
    const serviceClient = createServiceClient();
    const result = await defaultIntegrationEngine.rotateEndpointSecret(
      params.endpointId,
      integ.workspace_id,
      gracePeriodSeconds,
      serviceClient
    );

    return NextResponse.json({
      success: true,
      newPlainSecret: result.newPlainSecret,
      secretReference: result.secretReference,
      message: "Credencial rotada exitosamente. Se ha establecido un período de gracia de 24 horas para el secreto anterior.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
