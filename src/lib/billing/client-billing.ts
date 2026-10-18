export interface ModelUsageSummary {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  unpriced?: boolean;
}

/**
 * Función auxiliar para calcular consumo y monto facturable de un cliente en un período.
 */
export async function calculateClientBilling(
  serviceClient: any,
  clientId: string,
  periodStr: string,
  startOfMonthIso: string
) {
  // 1. Obtener modo de IA del cliente (nextex_keys vs byok)
  const { data: aiConfig } = await (serviceClient.from("client_ai_config") as any)
    .select("mode")
    .eq("client_id", clientId)
    .maybeSingle();

  const isByok = aiConfig?.mode === "byok";

  // 2. Obtener tarifas de facturación activas
  const { data: ratesRows } = await (serviceClient.from("billing_rates") as any)
    .select("model, input_price_per_1k, output_price_per_1k, currency")
    .eq("is_active", true);

  const ratesMap = new Map<string, { inputPrice: number; outputPrice: number }>();
  if (Array.isArray(ratesRows)) {
    for (const r of ratesRows) {
      ratesMap.set(r.model, {
        inputPrice: Number(r.input_price_per_1k) || 0,
        outputPrice: Number(r.output_price_per_1k) || 0,
      });
    }
  }

  // 3. Consultar consumo de tokens en el mes
  const { data: usageRows, error: usageErr } = await (serviceClient.from("token_usage") as any)
    .select("model, input_tokens, output_tokens, created_at")
    .eq("client_id", clientId)
    .gte("created_at", startOfMonthIso);

  if (usageErr) {
    throw new Error(usageErr.message);
  }

  const rows = Array.isArray(usageRows) ? usageRows : [];

  // 4. Agrupar por modelo
  const byModelMap: Record<string, { input: number; output: number }> = {};
  let tokensTotal = 0;

  for (const row of rows) {
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const model = row.model || "gemini-1.5-flash";

    if (!byModelMap[model]) {
      byModelMap[model] = { input: 0, output: 0 };
    }
    byModelMap[model].input += input;
    byModelMap[model].output += output;
    tokensTotal += input + output;
  }

  // 5. Calcular costo por modelo y total
  let amountTotal = 0;
  const byModel: ModelUsageSummary[] = [];

  for (const [model, stats] of Object.entries(byModelMap)) {
    const rate = ratesMap.get(model);
    if (!rate) {
      byModel.push({
        model,
        input_tokens: stats.input,
        output_tokens: stats.output,
        cost: 0,
        unpriced: true,
      });
    } else {
      const inputCost = (stats.input / 1000) * rate.inputPrice;
      const outputCost = (stats.output / 1000) * rate.outputPrice;
      const modelCost = Number((inputCost + outputCost).toFixed(6));
      amountTotal += modelCost;

      byModel.push({
        model,
        input_tokens: stats.input,
        output_tokens: stats.output,
        cost: Number(modelCost.toFixed(4)),
      });
    }
  }

  const finalAmount = Number(amountTotal.toFixed(4));

  return {
    period: periodStr,
    billable: !isByok,
    ...(isByok ? { reason: "El cliente usa sus propias claves" } : {}),
    tokens_total: tokensTotal,
    amount_estimate: finalAmount,
    currency: "USD",
    by_model: byModel,
  };
}
