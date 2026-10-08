import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/subscription
 * Permite al propietario (owner) del workspace cambiar su propio plan o asignar
 * planes de suscripción (free, pro, enterprise) a miembros del workspace.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { workspaceId, targetUserId, plan } = body;

    if (!workspaceId || !plan) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "workspaceId y plan son obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const normalizedPlan = plan.toLowerCase().trim();
    if (!["free", "pro", "enterprise"].includes(normalizedPlan)) {
      return NextResponse.json(
        { error: { code: "INVALID_PLAN", message: "El plan debe ser 'free', 'pro' o 'enterprise'.", statusCode: 400 } },
        { status: 400 }
      );
    }

    // 1. Validar que quien invoca la acción es OWNER del workspace
    const { data: callerMember, error: callerErr } = await (supabase.from("workspace_members") as any)
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (callerErr || !callerMember) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "No perteneces a este workspace.", statusCode: 403 } },
        { status: 403 }
      );
    }

    if (callerMember.role !== "owner") {
      return NextResponse.json(
        {
          error: {
            code: "OWNER_REQUIRED",
            message: "Solo el propietario (owner) del workspace tiene privilegios para cambiar o asignar planes de suscripción.",
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    const destinationUserId = targetUserId ? String(targetUserId).trim() : user.id;

    // 2. Si se asigna a otro usuario, verificar que pertenece al workspace
    if (destinationUserId !== user.id) {
      const { data: targetMember } = await (supabase.from("workspace_members") as any)
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", destinationUserId)
        .maybeSingle();

      if (!targetMember) {
        return NextResponse.json(
          { error: { code: "MEMBER_NOT_FOUND", message: "El usuario destino no es miembro activo del workspace.", statusCode: 404 } },
          { status: 404 }
        );
      }
    }

    // 3. Ejecutar actualización del plan en profiles mediante serviceClient para eludir RLS restrictivo
    const serviceClient = createServiceClient();
    const { data: updatedProfile, error: updateErr } = await (serviceClient.from("profiles") as any)
      .update({
        plan: normalizedPlan,
        updated_at: new Date().toISOString(),
      })
      .eq("id", destinationUserId)
      .select("id, full_name, plan, status")
      .single();

    if (updateErr || !updatedProfile) {
      throw updateErr || new Error("No se pudo actualizar el perfil.");
    }

    return NextResponse.json({
      success: true,
      profile: updatedProfile,
      message: `Plan ${normalizedPlan.toUpperCase()} asignado correctamente.`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al procesar suscripción.", statusCode: 500 } },
      { status: 500 }
    );
  }
}
