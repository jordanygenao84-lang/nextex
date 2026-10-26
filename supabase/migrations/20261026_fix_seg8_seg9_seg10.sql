-- ==============================================================================
-- FIX-SEG-8/9/10 (2026-10-26) — Corregir hallazgos de la auditoría integral
-- 1. SEC-009: tabla de llaves de idempotencia para métricas (el código de
--    /api/analytics/report ya la usa con fallback si aún no existe).
-- 2. SEC-008: retención de logs (90 días eventos, 365 días incidentes) con
--    job mensual en pg_cron.
-- 3. SEC-010b: la unique vigente de client_invoices es (client_id, period, kind)
--    (migración 20261024; antes fue (client_id, period)) y en ambos casos
--    pierde la factura de una segunda suscripción del mismo cliente en el
--    mismo periodo (el insert choca con 23505 y el código lo trata como
--    duplicado). Se amplía a (client_id, subscription_id, period, kind).
--    Es una restricción MÁS laxa: los datos existentes no pueden violarla.
--    Las facturas manuales (subscription_id NULL) no colisionan entre sí
--    porque Postgres trata los NULL como distintos en uniques.
-- 4. Bug 2026-10-26: client_invoices.updated_at no existe en producción
--    aunque la migración 20261017 la define — la tabla preexistía sin ella
--    y el IF NOT EXISTS no la agregó (misma deriva ya vista con created_at
--    de loterías). Sin ella fallan la generación de facturas, el PASO B del
--    motor, marcar como pagada y los listados de facturas. Se agrega abajo
--    con IF NOT EXISTS, junto con kind y subscription_id por si la
--    migración 20261024 tampoco corrió. Correr este archivo dos veces es
--    seguro.
-- ==============================================================================

-- 1. Llaves de idempotencia de métricas
CREATE TABLE IF NOT EXISTS public.metric_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    metric TEXT NOT NULL CHECK (metric IN ('visits', 'sales', 'orders', 'revenue')),
    metric_date DATE NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT metric_idempotency_keys_uq UNIQUE (client_id, metric, metric_date, idempotency_key)
);

ALTER TABLE public.metric_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Sin políticas para authenticated (denegado por defecto); solo service_role.
DROP POLICY IF EXISTS "Allow service_role full access on metric_idempotency_keys" ON public.metric_idempotency_keys;
CREATE POLICY "Allow service_role full access on metric_idempotency_keys"
    ON public.metric_idempotency_keys
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Retención de logs
CREATE OR REPLACE FUNCTION public.cleanup_old_logs() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.error_events WHERE last_seen_at < now() - INTERVAL '90 days';
  DELETE FROM public.security_events WHERE created_at < now() - INTERVAL '90 days';
  DELETE FROM public.incident_log WHERE created_at < now() - INTERVAL '365 days';
END;
$$;

-- Job mensual (día 1, 03:00 UTC). Si ya existe un job con este nombre, pg_cron
-- lo actualiza en lugar de duplicarlo.
SELECT cron.schedule('nextex-log-retention-monthly', '0 3 1 * *', $$SELECT public.cleanup_old_logs()$$);

-- 3. Reparación de columnas de client_invoices (ver punto 4 del encabezado)
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'consumption' CHECK (kind IN ('consumption', 'subscription'));
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES public.client_subscriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_invoices_subscription_status ON public.client_invoices (subscription_id, status);

-- 4. Unique de facturas: de (client_id, period, kind) a (client_id, subscription_id, period, kind)
--    (se eliminan ambas variantes viejas por si alguna quedó).
ALTER TABLE public.client_invoices DROP CONSTRAINT IF EXISTS client_invoices_client_period_key;
ALTER TABLE public.client_invoices DROP CONSTRAINT IF EXISTS client_invoices_client_period_kind_key;
ALTER TABLE public.client_invoices ADD CONSTRAINT client_invoices_sub_period_kind_key UNIQUE (client_id, subscription_id, period, kind);
