import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["owner", "admin", "member"] as const;
type WorkspaceRole = (typeof VALID_ROLES)[number];

function getAppBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, "");
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return "https://nextex-seven.vercel.app";
}

/**
 * GET /api/clients/[id]/invites
 * Lista las invitaciones pendientes para el workspace del cliente (con auth).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const clientId = params.id;
    const serviceClient = createServiceClient();

    // 1. Obtener workspace_id del cliente
    const { data: client, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id, workspace_id, display_name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client || !client.workspace_id) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente o workspace no encontrado." } },
        { status: 404 }
      );
    }

    const workspaceId = client.workspace_id;

    // 2. Verificar que el usuario tenga acceso al workspace o sea super_admin
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const { data: member } = await (serviceClient.from("workspace_members") as any)
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!member) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "No tienes permisos en este workspace." } },
          { status: 403 }
        );
      }
    }

    // 3. Consultar invitaciones pendientes (no aceptadas y vigentes)
    const nowIso = new Date().toISOString();
    const { data: invites, error } = await (serviceClient.from("workspace_invites") as any)
      .select("id, workspace_id, email, role, invited_by, token, expires_at, accepted_at, created_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    const appBaseUrl = getAppBaseUrl(req);
    const result = (invites || []).map((inv: any) => ({
      id: inv.id,
      workspace_id: inv.workspace_id,
      email: inv.email,
      role: inv.role,
      invited_by: inv.invited_by,
      token: inv.token,
      expires_at: inv.expires_at,
      created_at: inv.created_at,
      invite_link: `${appBaseUrl}/invite?token=${inv.token}`,
    }));

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar invitaciones." } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[id]/invites
 * Genera una invitación de acceso al workspace de un cliente (con auth).
 * Solo el dueño del workspace o super_admin puede invitar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const clientId = params.id;
    const serviceClient = createServiceClient();

    // 1. Resolver cliente y su workspace_id
    const { data: client, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id, workspace_id, display_name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client || !client.workspace_id) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente o workspace no encontrado." } },
        { status: 404 }
      );
    }

    const workspaceId = client.workspace_id;

    // 2. Verificar autorización: Solo dueño del workspace o super_admin
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      // Verificar si es owner en workspaces o en workspace_members
      const { data: wsRecord } = await (serviceClient.from("workspaces") as any)
        .select("owner_id")
        .eq("id", workspaceId)
        .maybeSingle();

      const isDirectOwner = wsRecord?.owner_id === user.id;

      let isOwnerMember = false;
      if (!isDirectOwner) {
        const { data: member } = await (serviceClient.from("workspace_members") as any)
          .select("role")
          .eq("workspace_id", workspaceId)
          .eq("user_id", user.id)
          .maybeSingle();

        isOwnerMember = member?.role === "owner";
      }

      if (!isDirectOwner && !isOwnerMember) {
        return NextResponse.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Solo el dueño del workspace o un superadministrador pueden generar invitaciones.",
            },
          },
          { status: 403 }
        );
      }
    }

    // 3. Validar payload
    const body = await req.json().catch(() => ({}));
    const { email, role } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "Se requiere un email válido." } },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRole: WorkspaceRole = role && VALID_ROLES.includes(role) ? role : "member";

    // 4. Generar token aleatorio de 32 caracteres hexadecimales y vencimiento a 7 días
    const token = randomBytes(16).toString("hex"); // 32 hex chars
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 5. Insertar invitación en public.workspace_invites
    const { data: invite, error: insertErr } = await (serviceClient.from("workspace_invites") as any)
      .insert({
        workspace_id: workspaceId,
        email: cleanEmail,
        role: cleanRole,
        invited_by: user.id,
        token,
        expires_at: expiresAt,
      })
      .select("id, email, role, token, expires_at")
      .single();

    if (insertErr || !invite) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al crear la invitación." } },
        { status: 500 }
      );
    }

    const appBaseUrl = getAppBaseUrl(req);
    const inviteLink = `${appBaseUrl}/invite?token=${invite.token}`;

    return NextResponse.json(
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        expires_at: invite.expires_at,
        invite_link: inviteLink,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al procesar la invitación." } },
      { status: 500 }
    );
  }
}
