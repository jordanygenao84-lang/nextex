-- ==============================================================================
-- Migración: Suscripciones y Cobro Recurrente (Nivel 1.19) (NIV2-1)
-- Tablas: client_subscriptions, alter client_invoices, alter incident_log
-- ==============================================================================

-- 1. Tabla: client_subscriptions (una suscripción por cliente en v1)
CREATE TABLE IF NOT EXISTS public.client_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
    plan_name TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'DOP')),
    billing_day INT CHECK (billing_day >= 1 AND billing_day <= 28),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'suspended', 'cancelled')),
    grace_days INT NOT NULL DEFAULT 3,
    next_invoice_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para client_subscriptions
CREATE INDEX IF NOT EXISTS idx_client_subscriptions_status_next_invoice
    ON public.client_subscriptions (status, next_invoice_date);

-- RLS para client_subscriptions (igual que las tablas de protección)
ALTER TABLE public.client_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on client_subscriptions" ON public.client_subscriptions;
CREATE POLICY "Allow authenticated read on client_subscriptions"
    ON public.client_subscriptions
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on client_subscriptions" ON public.client_subscriptions;
CREATE POLICY "Allow service_role full access on client_subscriptions"
    ON public.client_subscriptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Alterar client_invoices: agregar kind y subscription_id, y reemplazar unique (client_id, period) por (client_id, period, kind)
ALTER TABLE public.client_invoices
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'consumption' CHECK (kind IN ('consumption', 'subscription'));

ALTER TABLE public.client_invoices
    ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES public.client_subscriptions(id) ON DELETE SET NULL;

ALTER TABLE public.client_invoices
    DROP CONSTRAINT IF EXISTS client_invoices_client_period_key;

ALTER TABLE public.client_invoices
    DROP CONSTRAINT IF EXISTS client_invoices_client_period_kind_key;

ALTER TABLE public.client_invoices
    ADD CONSTRAINT client_invoices_client_period_kind_key UNIQUE (client_id, period, kind);

CREATE INDEX IF NOT EXISTS idx_client_invoices_subscription_status
    ON public.client_invoices (subscription_id, status);

-- 3. Ampliar el CHECK de incident_log.kind agregando 'billing_alert' y 'scan_completed'
--    (e incorporando cualquier valor existente en producción para evitar error 23514)
ALTER TABLE public.incident_log
    ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.incident_log
    DROP CONSTRAINT IF EXISTS incident_log_kind_check;

DO $$
DECLARE
    allowed_kinds TEXT;
BEGIN
    SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
    INTO allowed_kinds
    FROM (
        SELECT unnest(ARRAY[
            'health_down',
            'health_recovered',
            'attack_detected',
            'finding_opened',
            'finding_fixed',
            'scan_completed',
            'consumption_spike',
            'credential_alert',
            'billing_alert'
        ]) AS k
        UNION
        SELECT DISTINCT kind AS k
        FROM public.incident_log
        WHERE kind IS NOT NULL
    ) sub;

    EXECUTE format(
        'ALTER TABLE public.incident_log ADD CONSTRAINT incident_log_kind_check CHECK (kind IN (%s))',
        allowed_kinds
    );
END $$;
