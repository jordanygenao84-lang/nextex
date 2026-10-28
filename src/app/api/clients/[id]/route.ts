import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient, isSuperAdmin } from "@/lib/auth/roles";
import { AuditManager } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const [autoRes, jobsRes, agentsRes] = await Promise.all([
      serviceClient
        .from("automations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", client.workspace_id),
      serviceClient
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", client.workspace_id),
      serviceClient
        .from("agents")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", client.workspace_id),
    ]);

    const counts = {
      automations: autoRes.count || 0,
      jobs: jobsRes.count || 0,
      agents: agentsRes.count || 0,
    };

    return NextResponse.json({
      client,
      workspace: client.workspace || { id: client.workspace_id, name: client.display_name },
      counts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
    const existing = await resolveAuthorizedClient(user.id, clientId);

    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.display_name !== undefined) {
      if (typeof body.display_name !== "string" || !body.display_name.trim()) {
        return NextResponse.json(
          { error: { code: "INVALID_PARAMETERS", message: "El campo 'display_name' no puede estar vacío." } },
          { status: 400 }
        );
      }
      updates.display_name = body.display_name.trim();
    }

    if (body.website_url !== undefined) {
      if (body.website_url && typeof body.website_url === "string" && body.website_url.trim()) {
        try {
          const u = new URL(body.website_url.trim());
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            return NextResponse.json(
              { error: { code: "INVALID_URL", message: "La URL debe ser http o https válida." } },
              { status: 400 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: { code: "INVALID_URL", message: "URL inválida." } },
            { status: 400 }
          );
        }
        updates.website_url = body.website_url.trim();
      } else {
        updates.website_url = null;
      }
    }

    if (body.contact_name !== undefined) {
      updates.contact_name = body.contact_name ? String(body.contact_name).trim() : null;
    }
    if (body.contact_email !== undefined) {
      updates.contact_email = body.contact_email ? String(body.contact_email).trim() : null;
    }
    if (body.contact_phone !== undefined) {
      updates.contact_phone = body.contact_phone ? String(body.contact_phone).trim() : null;
    }
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(body.status)) {
        return NextResponse.json(
          { error: { code: "INVALID_STATUS", message: "El estado debe ser 'active' o 'inactive'." } },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }
    if (body.credit_limit_monthly !== undefined) {
      updates.credit_limit_monthly = body.credit_limit_monthly != null ? Number(body.credit_limit_monthly) : null;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes ? String(body.notes).trim() : null;
    }

    const { data: updatedClient, error: updateError } = await (serviceClient.from("clients") as any)
      .update(updates)
      .eq("id", clientId)
      .select("*, workspace:workspaces(id, name)")
      .single();

    if (updateError || !updatedClient) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (updates.display_name) {
      await (serviceClient.from("workspaces") as any)
        .update({ name: updates.display_name, updated_at: updates.updated_at })
        .eq("id", existing.workspace_id);
    }

    return NextResponse.json(updatedClient);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    // Borrar un cliente destruye su workspace entero por cascade: solo el
    // dueño del workspace o super_admin (mismo criterio que invites).
    // Los demás miembros reciben 404 para no revelar el recurso.
    const serviceClient = createServiceClient();
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const { data: wsRecord } = await (serviceClient.from("workspaces") as any)
        .select("owner_id")
        .eq("id", client.workspace_id)
        .maybeSingle();

      const isDirectOwner = wsRecord?.owner_id === user.id;

      let isOwnerMember = false;
      if (!isDirectOwner) {
        const { data: member } = await (serviceClient.from("workspace_members") as any)
          .select("role")
          .eq("workspace_id", client.workspace_id)
          .eq("user_id", user.id)
          .maybeSingle();

        isOwnerMember = member?.role === "owner";
      }

      if (!isDirectOwner && !isOwnerMember) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
          { status: 404 }
        );
      }
    }

    // Verificar si tiene jobs con ejecuciones en running o queued
    const { data: wsJobs } = await (serviceClient.from("jobs") as any)
      .select("id")
      .eq("workspace_id", client.workspace_id);

    if (wsJobs && wsJobs.length > 0) {
      const jobIds = wsJobs.map((j: any) => j.id);
      const { data: activeRuns } = await (serviceClient.from("job_runs") as any)
        .select("id, status")
        .in("job_id", jobIds)
        .in("status", ["running", "queued"])
        .limit(1);

      if (activeRuns && activeRuns.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: "ACTIVE_RUNS_EXIST",
              message: "No se puede eliminar el cliente porque tiene ejecuciones de jobs activas o en cola.",
            },
          },
          { status: 409 }
        );
      }
    }

    // Borrar workspace (ON DELETE CASCADE borra el cliente)
    const { error: delError } = await (serviceClient.from("workspaces") as any)
      .delete()
      .eq("id", client.workspace_id);

    if (delError) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    // Auditoría del borrado (best-effort): el evento NO se registra bajo el
    // workspace borrado — su historial se va con él por ON DELETE CASCADE y
    // la vista de auditoría está acotada al workspace del usuario — sino bajo
    // el primer workspace del usuario que borra, para que quede visible en su
    // auditoría. Sin esto, borrar un cliente no dejaba ningún rastro.
    try {
      const { data: deleterMember } = await (serviceClient.from("workspace_members") as any)
        .select("workspace_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (deleterMember?.workspace_id) {
        const audit = new AuditManager({
          workspaceId: deleterMember.workspace_id,
          supabaseClient: createServiceClient(),
        });
        await audit.recordEvent({
          workspaceId: deleterMember.workspace_id,
          actorId: user.id,
          actorType: "user",
          action: "client.deleted",
          resourceType: "workspace",
          resourceId: client.workspace_id,
          decision: "allow",
          reason: `Cliente eliminado: ${(client as any).display_name || clientId} (workspace ${client.workspace_id})`,
        });
      }
    } catch {
      // Auditoría best-effort: el borrado ya se completó.
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
