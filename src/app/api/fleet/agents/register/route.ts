import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { name, capabilities } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'name' es obligatorio." } },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const apiKeyHash = crypto.createHash("sha256").update(token).digest("hex");

    const defaultCapabilities = {
      max_vus: 5000,
      engines: ["http"],
      ...(typeof capabilities === "object" && capabilities !== null ? capabilities : {}),
    };

    const serviceClient = createServiceClient();
    const { data: agent, error } = await (serviceClient.from("fleet_agents") as any)
      .insert({
        name: name.trim(),
        api_key_hash: apiKeyHash,
        status: "offline",
        capabilities: defaultCapabilities,
      })
      .select("id, name")
      .single();

    if (error || !agent) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { id: agent.id, name: agent.name, api_key: token },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
