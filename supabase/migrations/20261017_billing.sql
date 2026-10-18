-- ==============================================================================
-- Migración: Billing Rates & Client Invoices (BaaS & Token Monetization)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: billing_rates
CREATE TABLE IF NOT EXISTS public.billing_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model TEXT NOT NULL UNIQUE,
    input_price_per_1k NUMERIC(10, 6) NOT NULL,
    output_price_per_1k NUMERIC(10, 6) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla: client_invoices
CREATE TABLE IF NOT EXISTS public.client_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    tokens_total BIGINT NOT NULL DEFAULT 0,
    amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_invoices_client_period_key UNIQUE (client_id, period)
);

-- 3. Índices para acelerar búsquedas y liquidaciones
CREATE INDEX IF NOT EXISTS idx_billing_rates_model 
    ON public.billing_rates (model);

CREATE INDEX IF NOT EXISTS idx_client_invoices_client_id 
    ON public.client_invoices (client_id);

CREATE INDEX IF NOT EXISTS idx_client_invoices_period 
    ON public.client_invoices (period);

CREATE INDEX IF NOT EXISTS idx_client_invoices_lookup 
    ON public.client_invoices (client_id, period);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.billing_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on billing_rates" ON public.billing_rates;
CREATE POLICY "Allow authenticated read on billing_rates"
    ON public.billing_rates
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on client_invoices" ON public.client_invoices;
CREATE POLICY "Allow authenticated read on client_invoices"
    ON public.client_invoices
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on billing_rates" ON public.billing_rates;
CREATE POLICY "Allow service_role full access on billing_rates"
    ON public.billing_rates
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on client_invoices" ON public.client_invoices;
CREATE POLICY "Allow service_role full access on client_invoices"
    ON public.client_invoices
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Trigger de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_billing_rates_updated_at ON public.billing_rates;
        CREATE TRIGGER set_billing_rates_updated_at
            BEFORE UPDATE ON public.billing_rates
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

        DROP TRIGGER IF EXISTS set_client_invoices_updated_at ON public.client_invoices;
        CREATE TRIGGER set_client_invoices_updated_at
            BEFORE UPDATE ON public.client_invoices
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;

-- 7. Seed Data: 4 Tarifas Base de Modelos
INSERT INTO public.billing_rates (model, input_price_per_1k, output_price_per_1k, currency, is_active)
VALUES
    ('gemini-1.5-flash', 0.000075, 0.000300, 'USD', true),
    ('gemini-1.5-pro',   0.001250, 0.005000, 'USD', true),
    ('gpt-4o',           0.005000, 0.015000, 'USD', true),
    ('claude-3-5-sonnet', 0.003000, 0.015000, 'USD', true)
ON CONFLICT (model) DO UPDATE SET
    input_price_per_1k = EXCLUDED.input_price_per_1k,
    output_price_per_1k = EXCLUDED.output_price_per_1k,
    currency = EXCLUDED.currency,
    is_active = EXCLUDED.is_active,
    updated_at = now();
