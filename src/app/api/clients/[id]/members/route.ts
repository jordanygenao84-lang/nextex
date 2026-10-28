import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/members
 * Lista los miembros actuales del workspace del cliente (con auth).
 * Retorna: [{ user_id, email, role, created_at }]
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
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client || !client.workspace_id) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const workspaceId = client.workspace_id;
    const serviceClient = createServiceClient();

    // 2. Consultar miembros del workspace
    const { data: members, error: memErr } = await (serviceClient.from("workspace_members") as any)
      .select("id, workspace_id, user_id, role, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    if (memErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: memErr.message } },
        { status: 500 }
      );
    }

    if (!members || members.length === 0) {
      return NextResponse.json([]);
    }

    // 3. Obtener emails de los usuarios mediante auth.admin
    const membersWithEmail = await Promise.all(
      members.map(async (m: any) => {
        let email = "Sin email";
        try {
          const { data: userData } = await serviceClient.auth.admin.getUserById(m.user_id);
          if (userData?.user?.email) {
            email = userData.user.email;
          }
        } catch {
          // Fallback si no se puede resolver
        }

        return {
          user_id: m.user_id,
          email,
          role: m.role,
          created_at: m.created_at,
        };
      })
    );

    return NextResponse.json(membersWithEmail);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
