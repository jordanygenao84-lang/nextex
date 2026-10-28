import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { sendVigiaAlert } from "@/lib/vigia/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/vigia/test-alert
 * Dispara una alerta de prueba a Telegram ignorando el filtro anti-ruido.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function POST(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    const telegramConfigured = Boolean(token && chatId);

    if (!telegramConfigured) {
      return NextResponse.json({
        ok: false,
        telegram_configured: false,
        message: "Telegram no está configurado. Faltan las variables TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.",
      });
    }

    const sent = await sendVigiaAlert(
      "✅ Prueba de VIGÍA",
      "El canal de alertas funciona correctamente desde NEXTEХ.",
      { force: true }
    );

    return NextResponse.json({
      ok: Boolean(sent),
      telegram_configured: true,
      sent: Boolean(sent),
      message: sent
        ? "Alerta de prueba enviada exitosamente a Telegram."
        : "No se pudo entregar a Telegram (verifique credenciales o conectividad).",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
