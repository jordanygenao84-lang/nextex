import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { calculateClientBilling } from "@/lib/billing/client-billing";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/billing
 * Estimación de facturación del mes actual para el cliente (con auth).
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

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // 2. Definir período actual
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = String(now.getMonth() + 1).padStart(2, "0");
    const periodStr = `${year}-${monthNum}`;
    const startOfMonthIso = new Date(year, now.getMonth(), 1).toISOString();

    // 3. Calcular estimación
    const billingSummary = await calculateClientBilling(
      serviceClient,
      clientId,
      periodStr,
      startOfMonthIso
    );

    return NextResponse.json(billingSummary);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
