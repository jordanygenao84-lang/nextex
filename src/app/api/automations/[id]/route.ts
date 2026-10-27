import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/automations/[id]
 * Borrado permanente de una automatización. Rechaza con 409 si algún job
 * del Control Plane la referencia (borrar primero esos jobs).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: auto } = await (supabase.from("automations") as any).select("workspace_id").eq("id", params.id).single();
    if (!auto) return NextResponse.json({ error: { code: "AUTOMATION_NOT_FOUND", message: "Automation no encontrada.", statusCode: 404 } }, { status: 404 });

    const canDelete = await defaultPermissionEngine.can(user.id, auto.workspace_id, "automations.delete", { supabaseClient: supabase });
    if (!canDelete.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canDelete.reason, statusCode: 403 } }, { status: 403 });
    }

    const { count: jobsRef } = await (supabase.from("jobs") as any)
      .select("id", { count: "exact", head: true })
      .eq("automation_id", params.id);
    if (jobsRef && jobsRef > 0) {
      return NextResponse.json(
        { error: { code: "AUTOMATION_HAS_JOBS", message: `No se puede eliminar: ${jobsRef} job(s) la referencian. Borra primero esos jobs.`, statusCode: 409 } },
        { status: 409 }
      );
    }

    const { error } = await (supabase.from("automations") as any)
      .delete()
      .eq("id", params.id)
      .eq("workspace_id", auto.workspace_id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: "Automatización eliminada exitosamente." });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: auto } = await (supabase.from("automations") as any).select("workspace_id").eq("id", params.id).single();
    if (!auto) return NextResponse.json({ error: { code: "AUTOMATION_NOT_FOUND", message: "Automation no encontrada.", statusCode: 404 } }, { status: 404 });

    const canUpdate = await defaultPermissionEngine.can(user.id, auto.workspace_id, "automations.update", { supabaseClient: supabase });
    if (!canUpdate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canUpdate.reason, statusCode: 403 } }, { status: 403 });
    }

    const body = await req.json();
    const { data: updated, error } = await (supabase.from("automations") as any)
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ automation: updated });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
