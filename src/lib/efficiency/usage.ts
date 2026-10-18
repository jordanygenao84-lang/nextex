import { createServiceClient } from "@/lib/supabase/server";

export interface LogTokenUsageParams {
  clientId?: string | null;
  workspaceId: string;
  conversationId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Registra el consumo de tokens en public.token_usage mediante service_role.
 */
export async function logTokenUsage({
  clientId,
  workspaceId,
  conversationId,
  model,
  inputTokens,
  outputTokens,
}: LogTokenUsageParams): Promise<void> {
  if (!workspaceId) {
    return;
  }

  try {
    const serviceClient = createServiceClient();
    await (serviceClient.from("token_usage") as any).insert({
      client_id: clientId || null,
      workspace_id: workspaceId,
      conversation_id: conversationId || null,
      model: model || "gemini-1.5-flash",
      input_tokens: Math.max(0, Math.round(inputTokens || 0)),
      output_tokens: Math.max(0, Math.round(outputTokens || 0)),
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Error al registrar consumo en token_usage:", err?.message || err);
  }
}

/**
 * Consulta el consumo de tokens del cliente en el mes en curso y compara contra monthly_token_cap.
 */
export async function checkMonthlyBudget(clientId: string): Promise<{
  used: number;
  cap: number | null;
  exceeded: boolean;
}> {
  if (!clientId) {
    return { used: 0, cap: null, exceeded: false };
  }

  try {
    const serviceClient = createServiceClient();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // 1. Obtener tope mensual desde client_ai_config
    const { data: aiConfig } = await (serviceClient.from("client_ai_config") as any)
      .select("monthly_token_cap")
      .eq("client_id", clientId)
      .maybeSingle();

    const cap = aiConfig?.monthly_token_cap != null ? Number(aiConfig.monthly_token_cap) : null;

    // 2. Sumar tokens consumidos durante el mes actual
    const { data: usageRecords, error } = await (serviceClient.from("token_usage") as any)
      .select("input_tokens, output_tokens")
      .eq("client_id", clientId)
      .gte("created_at", startOfMonth);

    let used = 0;
    if (!error && Array.isArray(usageRecords)) {
      used = usageRecords.reduce(
        (sum: number, row: any) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
        0
      );
    }

    const exceeded = cap !== null && used >= cap;

    return {
      used,
      cap,
      exceeded,
    };
  } catch (err: any) {
    console.error("Error al calcular presupuesto mensual:", err?.message || err);
    return { used: 0, cap: null, exceeded: false };
  }
}
