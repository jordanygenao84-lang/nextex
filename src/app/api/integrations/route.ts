import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { ConfigSanitizer } from "@/lib/integrations/validation/config-sanitizer";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations
 * Lista las integraciones configuradas para el workspace.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: { code: "WORKSPACE_REQUIRED", message: "workspaceId es obligatorio.", statusCode: 400 } }, { status: 400 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, workspaceId, "integrations.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { data: integrations, error } = await (supabase.from("integrations") as any)
      .select("*, integration_endpoints(*)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ integrations: integrations || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * POST /api/integrations
 * Registra una nueva integración en el workspace tras sanitizar su configuración.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, name, provider, integrationType, config } = body;

    if (!workspaceId || !name) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "workspaceId y name son campos obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    // Sanitización estricta de config para evitar almacenar credenciales
    if (config) {
      const configValidation = ConfigSanitizer.validate(config);
      if (!configValidation.valid) {
        return NextResponse.json(
          { error: { code: "CONFIG_CONTAINS_FORBIDDEN_KEYS", message: configValidation.errorMessage, statusCode: 400 } },
          { status: 400 }
        );
      }
    }

    const canCreate = await defaultPermissionEngine.can(user.id, workspaceId, "integrations.create", { supabaseClient: supabase });
    if (!canCreate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canCreate.reason, statusCode: 403 } }, { status: 403 });
    }

    const integration = await defaultIntegrationEngine.createIntegration(
      workspaceId,
      user.id,
      {
        name,
        provider,
        integration_type: integrationType,
        config,
      },
      supabase
    );

    return NextResponse.json({ integration }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
