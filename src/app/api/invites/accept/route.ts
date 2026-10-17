import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/invites/accept?token=<token>
 * Acepta una invitación de acceso a un workspace para el usuario autenticado.
 * - 401 si no está autenticado.
 * - 404 si el token no existe.
 * - 409 si ya fue aceptado.
 * - 410 si el token ha expirado.
 * - Inserta o actualiza en workspace_members con el rol otorgado.
 * - Marca accepted_at = now().
 */
export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Inicia sesión para aceptar la invitación." } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "Token de invitación requerido." } },
        { status: 400 }
      );
    }

    const cleanToken = token.trim();
    const serviceClient = createServiceClient();

    // 1. Buscar la invitación por token
    const { data: invite, error: fetchErr } = await (serviceClient.from("workspace_invites") as any)
      .select("id, workspace_id, email, role, token, expires_at, accepted_at")
      .eq("token", cleanToken)
      .maybeSingle();

    if (fetchErr || !invite) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Invitación no encontrada." } },
        { status: 404 }
      );
    }

    // 2. Si ya fue aceptada → 409
    if (invite.accepted_at) {
      return NextResponse.json(
        { error: { code: "ALREADY_ACCEPTED", message: "Esta invitación ya fue aceptada." } },
        { status: 409 }
      );
    }

    // 3. Si expiró → 410
    const now = new Date();
    const expiry = new Date(invite.expires_at);
    if (expiry < now) {
      return NextResponse.json(
        { error: { code: "EXPIRED", message: "La invitación ha expirado." } },
        { status: 410 }
      );
    }

    const nowIso = now.toISOString();

    // 4. Crear o actualizar membresía en public.workspace_members
    const { data: existingMember } = await (serviceClient.from("workspace_members") as any)
      .select("id, role")
      .eq("workspace_id", invite.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMember) {
      await (serviceClient.from("workspace_members") as any)
        .update({
          role: invite.role,
        })
        .eq("id", existingMember.id);
    } else {
      const { error: insertMemberErr } = await (serviceClient.from("workspace_members") as any)
        .insert({
          workspace_id: invite.workspace_id,
          user_id: user.id,
          role: invite.role,
        });

      if (insertMemberErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: insertMemberErr.message || "Error al registrar membresía en el workspace." } },
          { status: 500 }
        );
      }
    }

    // 5. Marcar invitación como aceptada
    await (serviceClient.from("workspace_invites") as any)
      .update({
        accepted_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", invite.id);

    return NextResponse.json(
      {
        ok: true,
        workspace_id: invite.workspace_id,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al aceptar la invitación." } },
      { status: 500 }
    );
  }
}
