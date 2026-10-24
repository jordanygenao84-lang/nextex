import { SupabaseClient } from "@supabase/supabase-js";
import { sendVigiaAlert } from "@/lib/vigia/notify";

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

export type SubscriptionCurrency = "USD" | "DOP";

export interface ClientSubscriptionRecord {
  id: string;
  client_id: string;
  plan_name: string;
  amount: number;
  currency: SubscriptionCurrency;
  billing_day: number | null;
  status: SubscriptionStatus;
  grace_days: number;
  next_invoice_date: string;
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    display_name: string;
  } | null;
}

export interface ProcessSubscriptionsResult {
  checked: number;
  invoices_generated: number;
  past_due_transitions: number;
  suspended_transitions: number;
  reactivated_transitions: number;
  alerts_sent: number;
  errors: string[];
}

/**
 * Obtiene la fecha actual en formato YYYY-MM-DD (UTC).
 */
export function getTodayUtcDateString(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Avanza next_invoice_date exactamente un mes hacia adelante respetando billing_day (1..28).
 */
export function advanceNextInvoiceDate(
  currentDateStr: string,
  billingDay?: number | null
): string {
  const parts = String(currentDateStr).slice(0, 10).split("-").map(Number);
  const year = parts[0] || new Date().getUTCFullYear();
  const month = parts[1] || new Date().getUTCMonth() + 1;
  const day = parts[2] || 1;

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = year + 1;
  }

  const maxDayInNextMonth = new Date(
    Date.UTC(nextYear, nextMonth, 0)
  ).getUTCDate();

  const desiredDay =
    typeof billingDay === "number" &&
    !isNaN(billingDay) &&
    billingDay >= 1 &&
    billingDay <= 28
      ? billingDay
      : Math.min(day, 28);

  const finalDay = Math.min(Math.max(1, desiredDay), maxDayInNextMonth);

  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(
    finalDay
  ).padStart(2, "0")}`;
}

/**
 * Calcula los días calendario transcurridos en UTC desde una fecha YYYY-MM-DD o ISO.
 */
export function calculateCalendarDaysSince(
  dateStrOrIso: string,
  now: Date = new Date()
): number {
  const datePart = String(dateStrOrIso).slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return 0;

  const targetUtc = Date.UTC(y, m - 1, d);
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return Math.round((todayUtc - targetUtc) / (1000 * 60 * 60 * 24));
}

/**
 * Verifica si el servicio de un cliente está activo según su suscripción.
 * Retorna false SOLO si la suscripción está en estado 'suspended' o 'cancelled'.
 * Si el cliente no tiene suscripción o está en 'active' / 'past_due', retorna true.
 * Nunca lanza excepción.
 */
export async function isClientServiceActive(
  clientId: string,
  supabaseClient?: SupabaseClient | any
): Promise<boolean> {
  if (!clientId) return true;

  try {
    let client = supabaseClient;
    if (!client) {
      const { createServiceClient } = await import("@/lib/supabase/server");
      client = createServiceClient();
    }

    const { data: sub, error } = await (
      client.from("client_subscriptions") as any
    )
      .select("status")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error) {
      console.error(
        `[BILLING] Error consultando estado de suscripción para cliente ${clientId}:`,
        error
      );
      return true;
    }

    if (!sub) {
      return true;
    }

    return sub.status !== "suspended" && sub.status !== "cancelled";
  } catch (err) {
    console.error(
      `[BILLING] Excepción en isClientServiceActive(${clientId}):`,
      err
    );
    return true;
  }
}

/**
 * Comprueba si ya existe un registro en incident_log kind='billing_alert'
 * para la tupla (subscription_id, invoice_id, status).
 */
function hasBillingAlertBeenLogged(
  existingAlerts: any[],
  subscriptionId: string,
  invoiceId: string,
  status: string
): boolean {
  return existingAlerts.some((row: any) => {
    const detail = row?.detail;
    if (!detail) return false;
    return (
      String(detail.subscription_id) === String(subscriptionId) &&
      String(detail.invoice_id) === String(invoiceId) &&
      String(detail.status) === String(status)
    );
  });
}

/**
 * Envía alerta por Telegram y registra el evento de deduplicación en incident_log (kind='billing_alert').
 */
async function emitBillingAlertWithDedup(params: {
  client: SupabaseClient | any;
  existingAlerts: any[];
  clientId: string;
  subscriptionId: string;
  invoiceId: string;
  status: SubscriptionStatus;
  title: string;
  body: string;
  extraDetail?: Record<string, any>;
}): Promise<boolean> {
  const {
    client,
    existingAlerts,
    clientId,
    subscriptionId,
    invoiceId,
    status,
    title,
    body,
    extraDetail,
  } = params;

  if (
    hasBillingAlertBeenLogged(
      existingAlerts,
      subscriptionId,
      invoiceId,
      status
    )
  ) {
    return false;
  }

  let sent = false;
  try {
    sent = await sendVigiaAlert(title, body, { force: true });
  } catch (alertErr) {
    console.error("[BILLING] Error enviando alerta Telegram:", alertErr);
  }

  const detailPayload = {
    subscription_id: subscriptionId,
    invoice_id: invoiceId,
    status,
    alerted: sent,
    channel: "telegram",
    sent_at: new Date().toISOString(),
    ...(extraDetail || {}),
  };

  try {
    await (client.from("incident_log") as any).insert({
      client_id: clientId,
      kind: "billing_alert",
      title,
      detail: detailPayload,
    });
    existingAlerts.push({ detail: detailPayload });
  } catch (logErr) {
    console.error(
      "[BILLING] Error insertando incident_log kind='billing_alert':",
      logErr
    );
  }

  return sent;
}

/**
 * Motor principal de suscripciones y cobro recurrente (NIV2-1).
 * 1. GENERACIÓN: Suscripciones en active/past_due con next_invoice_date <= hoy generan factura kind='subscription'
 *    y avanzan next_invoice_date un mes (respetando billing_day).
 * 2. MORA: Facturas de suscripción 'pending' cuya fecha de factura + grace_days ya pasó -> 'past_due' + alerta.
 * 3. SUSPENSIÓN: Si la mora supera grace_days + 7 días -> 'suspended' + alerta.
 * 4. REACTIVACIÓN: Suscripciones past_due/suspended sin facturas de suscripción 'pending' -> 'active' + alerta.
 * Nunca lanza excepción.
 */
export async function processSubscriptions(
  supabaseClient?: SupabaseClient | any
): Promise<ProcessSubscriptionsResult> {
  const result: ProcessSubscriptionsResult = {
    checked: 0,
    invoices_generated: 0,
    past_due_transitions: 0,
    suspended_transitions: 0,
    reactivated_transitions: 0,
    alerts_sent: 0,
    errors: [],
  };

  try {
    let client = supabaseClient;
    if (!client) {
      const { createServiceClient } = await import("@/lib/supabase/server");
      client = createServiceClient();
    }

    // 1. Cargar todas las suscripciones no canceladas junto con el nombre del cliente
    const { data: subscriptions, error: subErr } = await (
      client.from("client_subscriptions") as any
    )
      .select(`
        id,
        client_id,
        plan_name,
        amount,
        currency,
        billing_day,
        status,
        grace_days,
        next_invoice_date,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name
        )
      `)
      .neq("status", "cancelled");

    if (subErr) {
      console.error(
        "[BILLING] Error al consultar client_subscriptions:",
        subErr
      );
      result.errors.push(subErr.message || "Error consultando suscripciones");
      return result;
    }

    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return result;
    }

    result.checked = subscriptions.length;

    // 2. Cargar historial previo de incident_log kind='billing_alert' para deduplicación
    const { data: pastIncidents, error: incErr } = await (
      client.from("incident_log") as any
    )
      .select("id, detail")
      .eq("kind", "billing_alert");

    if (incErr) {
      console.warn(
        "[BILLING] Error consultando incident_log para dedup:",
        incErr
      );
    }

    const existingAlerts: any[] = Array.isArray(pastIncidents)
      ? [...pastIncidents]
      : [];

    const now = new Date();
    const todayStr = getTodayUtcDateString(now);
    const msPerDay = 24 * 60 * 60 * 1000;

    for (const sub of subscriptions) {
      try {
        const clientName =
          sub.client?.display_name || `Cliente ${sub.client_id.slice(0, 8)}`;
        let currentStatus: SubscriptionStatus = sub.status;
        const graceDays =
          typeof sub.grace_days === "number" && !isNaN(sub.grace_days)
            ? Math.max(0, sub.grace_days)
            : 3;

        // =========================================================================
        // PASO A: GENERACIÓN DE FACTURA SI next_invoice_date <= hoy
        // =========================================================================
        if (
          (currentStatus === "active" || currentStatus === "past_due") &&
          sub.next_invoice_date &&
          String(sub.next_invoice_date).slice(0, 10) <= todayStr
        ) {
          const invoiceDateStr = String(sub.next_invoice_date).slice(0, 10);
          const periodStr = invoiceDateStr.slice(0, 7); // 'YYYY-MM'
          const nextInvoiceDate = advanceNextInvoiceDate(
            invoiceDateStr,
            sub.billing_day
          );

          // Si next_invoice_date era una fecha pasada, fechamos created_at en esa fecha para respetar el cómputo de mora
          const invoiceCreatedAt =
            invoiceDateStr < todayStr
              ? new Date(`${invoiceDateStr}T00:00:00.000Z`).toISOString()
              : now.toISOString();

          const { data: createdInv, error: invInsertErr } = await (
            client.from("client_invoices") as any
          )
            .insert({
              client_id: sub.client_id,
              subscription_id: sub.id,
              kind: "subscription",
              period: periodStr,
              tokens_total: 0,
              amount: Number(sub.amount),
              currency: sub.currency || "USD",
              status: "pending",
              created_at: invoiceCreatedAt,
              updated_at: now.toISOString(),
            })
            .select("id")
            .maybeSingle();

          if (invInsertErr) {
            // Si es duplicado por unique (client_id, period, kind), igual avanzamos next_invoice_date para no ciclar
            const isDuplicate =
              invInsertErr.code === "23505" ||
              String(invInsertErr.message || "")
                .toLowerCase()
                .includes("duplicate");
            if (!isDuplicate) {
              console.error(
                `[BILLING] Error creando factura de suscripción (${sub.id}):`,
                invInsertErr
              );
              result.errors.push(
                `Error creando factura para ${clientName}: ${invInsertErr.message}`
              );
            }
          } else if (createdInv) {
            result.invoices_generated++;
          }

          // Avanzar next_invoice_date un mes respetando billing_day
          const { error: advErr } = await (
            client.from("client_subscriptions") as any
          )
            .update({
              next_invoice_date: nextInvoiceDate,
              updated_at: now.toISOString(),
            })
            .eq("id", sub.id);

          if (advErr) {
            console.error(
              `[BILLING] Error avanzando next_invoice_date (${sub.id}):`,
              advErr
            );
            result.errors.push(
              `Error avanzando fecha de suscripción ${sub.id}: ${advErr.message}`
            );
          }
        }

        // =========================================================================
        // PASO B: CONSULTAR FACTURAS DE SUSCRIPCIÓN DEL CLIENTE
        // =========================================================================
        const { data: subInvoices, error: fetchInvErr } = await (
          client.from("client_invoices") as any
        )
          .select(
            "id, period, amount, currency, status, created_at, updated_at"
          )
          .eq("client_id", sub.client_id)
          .eq("kind", "subscription")
          .order("created_at", { ascending: false });

        if (fetchInvErr) {
          console.error(
            `[BILLING] Error consultando facturas de suscripción (${sub.id}):`,
            fetchInvErr
          );
          result.errors.push(fetchInvErr.message);
          continue;
        }

        const allSubInvoices = Array.isArray(subInvoices) ? subInvoices : [];
        const pendingInvoices = allSubInvoices.filter(
          (inv: any) => inv.status === "pending"
        );

        // =========================================================================
        // PASO C: REACTIVACIÓN (past_due o suspended sin facturas 'pending')
        // =========================================================================
        if (
          (currentStatus === "past_due" || currentStatus === "suspended") &&
          pendingInvoices.length === 0
        ) {
          const { error: reactivateErr } = await (
            client.from("client_subscriptions") as any
          )
            .update({
              status: "active",
              updated_at: now.toISOString(),
            })
            .eq("id", sub.id);

          if (reactivateErr) {
            console.error(
              `[BILLING] Error reactivando suscripción (${sub.id}):`,
              reactivateErr
            );
            result.errors.push(reactivateErr.message);
          } else {
            currentStatus = "active";
            result.reactivated_transitions++;

            const latestResolvedInvoice = allSubInvoices[0];
            const refInvoiceId = latestResolvedInvoice?.id || "none";
            const alertTitle = `✅ ${clientName} está al día; servicio reactivado`;
            const alertBody = `Cliente: ${clientName}\nPlan: ${sub.plan_name}\nEstado: active`;

            const sent = await emitBillingAlertWithDedup({
              client,
              existingAlerts,
              clientId: sub.client_id,
              subscriptionId: sub.id,
              invoiceId: refInvoiceId,
              status: "active",
              title: alertTitle,
              body: alertBody,
              extraDetail: {
                plan_name: sub.plan_name,
              },
            });
            if (sent) result.alerts_sent++;
          }
          continue;
        }

        // =========================================================================
        // PASO D: MORA (past_due) Y SUSPENSIÓN (suspended) SOBRE FACTURAS PENDING
        // =========================================================================
        if (pendingInvoices.length > 0) {
          for (const inv of pendingInvoices) {
            const createdMs = new Date(inv.created_at).getTime();
            const elapsedMs = now.getTime() - createdMs;
            const calendarDays = calculateCalendarDaysSince(
              inv.created_at,
              now
            );

            // Mora supera grace_days + 7 días -> suspended
            const isSuspensionOverdue =
              calendarDays > graceDays + 7 ||
              (calendarDays >= graceDays + 7 &&
                elapsedMs > (graceDays + 7) * msPerDay);

            // Fecha de factura + grace_days ya pasó -> past_due
            const isPastDueOverdue =
              graceDays === 0
                ? calendarDays >= 1
                : calendarDays > graceDays ||
                  (calendarDays >= graceDays &&
                    elapsedMs > graceDays * msPerDay);

            const amountFormatted = Number(inv.amount ?? sub.amount).toFixed(2);
            const currencyStr = inv.currency || sub.currency || "USD";

            if (isSuspensionOverdue) {
              if (currentStatus !== "suspended") {
                const { error: suspErr } = await (
                  client.from("client_subscriptions") as any
                )
                  .update({
                    status: "suspended",
                    updated_at: now.toISOString(),
                  })
                  .eq("id", sub.id);

                if (suspErr) {
                  console.error(
                    `[BILLING] Error pasando suscripción a suspended (${sub.id}):`,
                    suspErr
                  );
                  result.errors.push(suspErr.message);
                } else {
                  currentStatus = "suspended";
                  result.suspended_transitions++;
                }
              }

              const alertTitle = `⛔ Servicio suspendido por falta de pago — ${clientName}`;
              const alertBody = `Cliente: ${clientName}\nPlan: ${sub.plan_name}\nPeriodo: ${inv.period}\nMonto: ${amountFormatted} ${currencyStr}\nEstado: suspended`;

              const sent = await emitBillingAlertWithDedup({
                client,
                existingAlerts,
                clientId: sub.client_id,
                subscriptionId: sub.id,
                invoiceId: inv.id,
                status: "suspended",
                title: alertTitle,
                body: alertBody,
                extraDetail: {
                  period: inv.period,
                  amount: Number(inv.amount ?? sub.amount),
                  currency: currencyStr,
                },
              });
              if (sent) result.alerts_sent++;
            } else if (isPastDueOverdue) {
              if (currentStatus === "active") {
                const { error: moraErr } = await (
                  client.from("client_subscriptions") as any
                )
                  .update({
                    status: "past_due",
                    updated_at: now.toISOString(),
                  })
                  .eq("id", sub.id);

                if (moraErr) {
                  console.error(
                    `[BILLING] Error pasando suscripción a past_due (${sub.id}):`,
                    moraErr
                  );
                  result.errors.push(moraErr.message);
                } else {
                  currentStatus = "past_due";
                  result.past_due_transitions++;
                }
              }

              const alertTitle = `🧾 Factura vencida — ${clientName}, ${amountFormatted} ${currencyStr}`;
              const alertBody = `Cliente: ${clientName}\nPlan: ${sub.plan_name}\nPeriodo: ${inv.period}\nMonto: ${amountFormatted} ${currencyStr}\nEstado: past_due`;

              const sent = await emitBillingAlertWithDedup({
                client,
                existingAlerts,
                clientId: sub.client_id,
                subscriptionId: sub.id,
                invoiceId: inv.id,
                status: "past_due",
                title: alertTitle,
                body: alertBody,
                extraDetail: {
                  period: inv.period,
                  amount: Number(inv.amount ?? sub.amount),
                  currency: currencyStr,
                },
              });
              if (sent) result.alerts_sent++;
            }
          }
        }
      } catch (subLoopErr: any) {
        console.error(
          `[BILLING] Excepción procesando suscripción ${sub?.id}:`,
          subLoopErr
        );
        result.errors.push(
          subLoopErr?.message || `Error en suscripción ${sub?.id}`
        );
      }
    }
  } catch (err: any) {
    console.error("[BILLING] Excepción general en processSubscriptions:", err);
    result.errors.push(err?.message || "Excepción general en motor de cobro");
  }

  return result;
}
