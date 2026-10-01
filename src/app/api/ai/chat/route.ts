import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultAIGateway } from "@/lib/omniengine/gateway/gateway";
import { AIRequestPayload } from "@/lib/omniengine/types";
import { OmniEngineError, OmniErrorCodes } from "@/lib/omniengine/types/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chat
 * Entrada principal al AI Gateway de NEXTEХ con soporte de Streaming SSE.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1. Verificación de autenticación
    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: OmniErrorCodes.AUTH_REQUIRED,
            message: "Se requiere una sesión activa para interactuar con los modelos de IA.",
            statusCode: 401,
          },
        },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      workspaceId: reqWorkspaceId,
      model,
      messages,
      conversationId,
      stream = true,
      options,
    } = body;

    // 2. Identificar workspace si no viene en el payload
    let targetWorkspaceId = reqWorkspaceId;
    if (!targetWorkspaceId) {
      const { data: personalWs } = (await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()) as any;

      targetWorkspaceId = personalWs?.id;
    }

    if (!targetWorkspaceId) {
      return NextResponse.json(
        {
          error: {
            code: OmniErrorCodes.WORKSPACE_FORBIDDEN,
            message: "No se identificó un workspace válido para procesar la petición.",
            statusCode: 400,
          },
        },
        { status: 400 }
      );
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const payload: AIRequestPayload = {
      requestId,
      workspaceId: targetWorkspaceId,
      userId: user.id,
      conversationId,
      model: model || "gemini-1.5-flash",
      messages: messages || [],
      options: {
        ...options,
        stream: Boolean(stream),
      },
    };

    // 3. Flujo en Streaming (SSE)
    if (stream) {
      const responseStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const chunk of defaultAIGateway.executeStream(payload, supabase)) {
              const data = `data: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (err: any) {
            const errorDetails =
              err instanceof OmniEngineError
                ? err.toJSON()
                : {
                    code: OmniErrorCodes.INTERNAL_ERROR,
                    message: err?.message || "Error durante el procesamiento del stream.",
                    statusCode: 500,
                  };

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: errorDetails })}\n\n`)
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // 4. Flujo estándar (No-streaming)
    const response = await defaultAIGateway.execute(payload, supabase);
    return NextResponse.json({ data: response });
  } catch (err: any) {
    if (err instanceof OmniEngineError) {
      return NextResponse.json({ error: err.toJSON() }, { status: err.statusCode });
    }

    return NextResponse.json(
      {
        error: {
          code: OmniErrorCodes.INTERNAL_ERROR,
          message: err?.message || "Error interno del servidor en AI Gateway.",
          statusCode: 500,
        },
      },
      { status: 500 }
    );
  }
}
