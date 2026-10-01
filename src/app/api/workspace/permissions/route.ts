import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { AgentErrorCodes } from "@/lib/agents/types/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/permissions?workspaceId=...
 * Obtiene los overrides explícitos de permisos del workspace.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId requerido" }, { status: 400 });
    }

    const { data: overrides, error } = await (supabase.from("workspace_permissions") as any)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, overrides: overrides || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al obtener permisos" }, { status: 500 });
  }
}

/**
 * POST /api/workspace/permissions
 * Registra o actualiza un override de permiso verificando jerarquía administrativa.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const { workspace_id, user_id, permission_key, effect } = body;

    if (!workspace_id || !user_id || !permission_key || !["allow", "deny"].includes(effect)) {
      return NextResponse.json({ error: "Parámetros incompletos o inválidos" }, { status: 400 });
    }

    // 1. Anti-Auto-Modificación
    if (user_id === user.id) {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY,
            message: "No puedes modificar tus propios permisos administrativos.",
          },
        },
        { status: 403 }
      );
    }

    // 2. Validar rol del invocador y del target en workspace_members
    const { data: callerMember } = await (supabase.from("workspace_members") as any)
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!callerMember || callerMember.role === "member") {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY,
            message: "Los usuarios con rol member no pueden administrar permisos.",
          },
        },
        { status: 403 }
      );
    }

    const { data: targetMember } = await (supabase.from("workspace_members") as any)
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (!targetMember) {
      return NextResponse.json({ error: "El usuario destino no pertenece a este workspace." }, { status: 404 });
    }

    // 3. Reglas de jerarquía
    if (targetMember.role === "owner" && callerMember.role !== "owner") {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY,
            message: "Los administradores no pueden alterar permisos del Owner.",
          },
        },
        { status: 403 }
      );
    }

    if (targetMember.role === "admin" && callerMember.role === "admin") {
      return NextResponse.json(
        {
          error: {
            code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY,
            message: "Los administradores no pueden alterar permisos de otros administradores.",
          },
        },
        { status: 403 }
      );
    }

    // 4. Upsert en workspace_permissions
    const { data: saved, error: saveErr } = await (supabase.from("workspace_permissions") as any)
      .upsert(
        {
          workspace_id,
          user_id,
          permission_key,
          effect,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id,permission_key" }
      )
      .select()
      .single();

    if (saveErr) {
      return NextResponse.json({ error: saveErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, override: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error al actualizar permiso" }, { status: 500 });
  }
}
