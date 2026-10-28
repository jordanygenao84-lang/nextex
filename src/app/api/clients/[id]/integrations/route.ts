import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

interface RequiredCredentialSpec {
  key: string;
  label?: string;
  type?: "password" | "text" | "oauth" | string;
  required?: boolean;
}

async function validateIntegrationCredentials(
  blueprintSlug: string,
  credentials: Record<string, any>
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    if (blueprintSlug === "instagram-dm") {
      const igBusinessId =
        credentials.instagram_business_id || credentials.page_id || credentials.business_id;
      const accessToken =
        credentials.page_access_token || credentials.access_token || credentials.token;

      if (!igBusinessId || !accessToken) {
        return false;
      }

      const res = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(String(igBusinessId).trim())}?fields=id,username`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${String(accessToken).trim()}`,
          },
          signal: controller.signal,
        }
      );

      return res.status === 200;
    }

    if (blueprintSlug === "whatsapp-bot") {
      const phoneNumberId = credentials.phone_number_id;
      const apiToken =
        credentials.api_token || credentials.access_token || credentials.token;

      if (!phoneNumberId || !apiToken) {
        return false;
      }

      const res = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(String(phoneNumberId).trim())}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${String(apiToken).trim()}`,
          },
          signal: controller.signal,
        }
      );

      return res.status === 200;
    }

    // Para blueprints sin endpoint de test predefinido o en modo oauth
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

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

    // Consultar integraciones del cliente (NUNCA devolver encrypted_credentials)
    const { data: integrations, error: intErr } = await (serviceClient.from("client_integrations") as any)
      .select("id, blueprint_slug, label, is_active, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (intErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    // Consultar nombres de blueprints para resolver blueprint_name
    const { data: blueprints } = await (serviceClient.from("integration_blueprints") as any)
      .select("slug, name");

    const blueprintNameMap = new Map<string, string>();
    if (Array.isArray(blueprints)) {
      for (const bp of blueprints) {
        blueprintNameMap.set(bp.slug, bp.name);
      }
    }

    const result = (integrations || []).map((item: any) => ({
      id: item.id,
      blueprint_slug: item.blueprint_slug,
      blueprint_name: blueprintNameMap.get(item.blueprint_slug) || item.label || item.blueprint_slug,
      label: item.label,
      is_active: item.is_active,
      created_at: item.created_at,
    }));

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    const body = await req.json().catch(() => ({}));
    const { blueprint_slug, label, credentials } = body;

    if (!blueprint_slug || typeof blueprint_slug !== "string") {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'blueprint_slug' es requerido." } },
        { status: 400 }
      );
    }

    // 1. Validar que el blueprint existe y está activo
    const { data: blueprint, error: bpErr } = await (serviceClient.from("integration_blueprints") as any)
      .select("slug, name, required_credentials, is_active")
      .eq("slug", blueprint_slug)
      .eq("is_active", true)
      .maybeSingle();

    if (bpErr || !blueprint) {
      return NextResponse.json(
        { error: { code: "INVALID_BLUEPRINT", message: `Blueprint '${blueprint_slug}' no encontrado o inactivo.` } },
        { status: 400 }
      );
    }

    const credsObj: Record<string, any> =
      credentials && typeof credentials === "object" ? { ...credentials } : {};

    const requiredSpecs: RequiredCredentialSpec[] = Array.isArray(blueprint.required_credentials)
      ? blueprint.required_credentials
      : [];

    let hasOauth = false;
    for (const spec of requiredSpecs) {
      if (spec.type === "oauth") {
        hasOauth = true;
      } else if (spec.type === "password" || spec.type === "text" || !spec.type) {
        const val = credsObj[spec.key];
        const isMissing = val === undefined || val === null || (typeof val === "string" && !val.trim());
        if (spec.required !== false && isMissing) {
          return NextResponse.json(
            { error: { code: "MISSING_CREDENTIALS", message: `Falta la credencial requerida: '${spec.key}'.` } },
            { status: 400 }
          );
        }
      }
    }

    if (hasOauth && !credsObj.oauth_token) {
      credsObj.oauth_pending = true;
    }

    // 2. Probar credenciales contra proveedor externo si aplica
    if (blueprint_slug === "instagram-dm" || blueprint_slug === "whatsapp-bot") {
      const isValid = await validateIntegrationCredentials(blueprint_slug, credsObj);
      if (!isValid) {
        // Regla: si falla -> 400 { error: 'Credenciales no válidas para <slug>' } sin guardar
        return NextResponse.json(
          { error: `Credenciales no válidas para ${blueprint_slug}` },
          { status: 400 }
        );
      }
    }

    // 3. Cifrar el JSON de credentials con SecretVault.encryptValue
    const aad = `nextex:client-integration:${clientId}:${blueprint_slug}`;
    const encrypted = SecretVault.encryptValue(JSON.stringify(credsObj), aad);

    const encryptedCredentials = JSON.stringify({
      encryptedSecret: encrypted.encryptedSecret,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    const integrationLabel = label?.trim() || blueprint.name;

    // 4. Guardar en public.client_integrations (soporta reactivación si ya existía la combinación única)
    const { data: existingIntegration } = await (serviceClient.from("client_integrations") as any)
      .select("id")
      .eq("client_id", clientId)
      .eq("blueprint_slug", blueprint_slug)
      .eq("label", integrationLabel)
      .maybeSingle();

    let savedRecord: any = null;

    if (existingIntegration) {
      const { data: updated, error: updateErr } = await (serviceClient.from("client_integrations") as any)
        .update({
          encrypted_credentials: encryptedCredentials,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingIntegration.id)
        .select("id, blueprint_slug, label")
        .single();

      if (updateErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
          { status: 500 }
        );
      }
      savedRecord = updated;
    } else {
      const { data: inserted, error: insertErr } = await (serviceClient.from("client_integrations") as any)
        .insert({
          client_id: clientId,
          blueprint_slug,
          label: integrationLabel,
          encrypted_credentials: encryptedCredentials,
          is_active: true,
        })
        .select("id, blueprint_slug, label")
        .single();

      if (insertErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
          { status: 500 }
        );
      }
      savedRecord = inserted;
    }

    // 5. Responder 201 con { id, blueprint_slug, label }
    return NextResponse.json(
      {
        id: savedRecord.id,
        blueprint_slug: savedRecord.blueprint_slug,
        label: savedRecord.label,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
