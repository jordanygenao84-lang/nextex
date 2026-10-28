import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["ok", "failed", "rolled_back"]);

async function requireSuperAdmin() {
  const userClient = createClient();
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      ),
    };
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, user };
}

/**
 * GET /api/admin/deployments?client_id=...
 * Lista los despliegues de un cliente por fecha descendente e identifica el último commit 'ok'.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const clientId = req.nextUrl.searchParams.get("client_id")?.trim();
    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El parámetro 'client_id' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: deployments, error: dbErr } = await (
      serviceClient.from("deployments") as any
    )
      .select(
        "id, client_id, commit_hash, commit_message, deployed_at, deployed_by, status, notes, previous_commit"
      )
      .eq("client_id", clientId)
      .order("deployed_at", { ascending: false });

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: dbErr.message } },
        { status: 500 }
      );
    }

    const list = deployments || [];
    const lastOk = list.find((d: any) => d.status === "ok");

    return NextResponse.json({
      deployments: list,
      total: list.length,
      last_ok_commit: lastOk ? lastOk.commit_hash : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/deployments?client_id=...
 * Registra un nuevo despliegue.
 * Calcula automáticamente previous_commit = último commit 'ok' anterior del cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const queryClientId = req.nextUrl.searchParams.get("client_id")?.trim();
    const bodyClientId =
      typeof body.client_id === "string" ? body.client_id.trim() : "";
    const clientId = queryClientId || bodyClientId;

    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'client_id' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const commitHash =
      typeof body.commit_hash === "string" ? body.commit_hash.trim() : "";
    if (!commitHash) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'commit_hash' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const status =
      typeof body.status === "string" && body.status.trim()
        ? body.status.trim()
        : "ok";
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El estado debe ser 'ok', 'failed' o 'rolled_back'.",
          },
        },
        { status: 400 }
      );
    }

    const commitMessage =
      typeof body.commit_message === "string" && body.commit_message.trim()
        ? body.commit_message.trim()
        : null;
    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null;
    const deployedBy =
      typeof body.deployed_by === "string" && body.deployed_by.trim()
        ? body.deployed_by.trim()
        : auth.user.email || auth.user.id;

    const serviceClient = createServiceClient();

    // Calcular previous_commit: el último commit 'ok' anterior del cliente
    const { data: prevOkRow } = await (serviceClient.from("deployments") as any)
      .select("commit_hash")
      .eq("client_id", clientId)
      .eq("status", "ok")
      .order("deployed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const previousCommit = prevOkRow?.commit_hash || null;

    const { data: created, error: insertErr } = await (
      serviceClient.from("deployments") as any
    )
      .insert({
        client_id: clientId,
        commit_hash: commitHash,
        commit_message: commitMessage,
        deployed_by: deployedBy,
        status,
        notes,
        previous_commit: previousCommit,
      })
      .select(
        "id, client_id, commit_hash, commit_message, deployed_at, deployed_by, status, notes, previous_commit"
      )
      .single();

    if (insertErr || !created) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message:
              insertErr?.message || "No se pudo registrar el despliegue.",
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ deployment: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/deployments?client_id=...
 * Exclusivo para marcar un despliegue como 'rolled_back' y actualizar 'notes'.
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const deploymentId =
      req.nextUrl.searchParams.get("id")?.trim() ||
      (typeof body.id === "string" ? body.id.trim() : "");

    if (!deploymentId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'id' del despliegue es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    if (body.status !== undefined && body.status !== "rolled_back") {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "PATCH solo permite marcar el despliegue como 'rolled_back'.",
          },
        },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      status: "rolled_back",
    };

    if (body.notes !== undefined) {
      updates.notes =
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim()
          : null;
    }

    const clientId =
      req.nextUrl.searchParams.get("client_id")?.trim() ||
      (typeof body.client_id === "string" ? body.client_id.trim() : "");

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("deployments") as any)
      .update(updates)
      .eq("id", deploymentId);

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data: updated, error: updateErr } = await query
      .select(
        "id, client_id, commit_hash, commit_message, deployed_at, deployed_by, status, notes, previous_commit"
      )
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Despliegue no encontrado.",
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ deployment: updated });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
