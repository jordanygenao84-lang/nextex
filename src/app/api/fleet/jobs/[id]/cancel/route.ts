import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserWorkspaces, isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const allowedWorkspaces = await getUserWorkspaces(user.id);
      if (allowedWorkspaces.length === 0) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Trabajo no encontrado." } }, { status: 404 });
      }
    }

    const serviceClient = createServiceClient();
    const jobId = params.id;

    const { data: existing } = await (serviceClient.from("fleet_jobs") as any)
      .select("id, status, created_by")
      .eq("id", jobId)
      .maybeSingle();

    if (!existing || (!superAdmin && existing.created_by !== user.id)) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Trabajo no encontrado." } }, { status: 404 });
    }

    if (!["queued", "running"].includes(existing.status)) {
      return NextResponse.json(
        { error: { code: "CANNOT_CANCEL", message: `El trabajo no se puede cancelar porque está en estado '${existing.status}'.` } },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: cancelledJob, error } = await (serviceClient.from("fleet_jobs") as any)
      .update({
        status: "cancelled",
        finished_at: nowIso,
      })
      .eq("id", jobId)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
    }

    return NextResponse.json({ ok: true, job: cancelledJob });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al cancelar trabajo." } },
      { status: 500 }
    );
  }
}
