-- ==============================================================================
-- Migración: Lottery Catalog & Results Tracking
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: lottery_catalog
CREATE TABLE IF NOT EXISTS public.lottery_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    country TEXT NOT NULL DEFAULT 'DO',
    official_url TEXT,
    draw_times JSONB NOT NULL DEFAULT '[]'::jsonb,
    extraction_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla: lottery_results
CREATE TABLE IF NOT EXISTS public.lottery_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lottery_id UUID NOT NULL REFERENCES public.lottery_catalog(id) ON DELETE CASCADE,
    draw_date DATE NOT NULL,
    draw_time TEXT NOT NULL,
    numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lottery_results_lottery_date_time_key UNIQUE (lottery_id, draw_date, draw_time)
);

-- 3. Índices para acelerar búsquedas y consultas de resultados
CREATE INDEX IF NOT EXISTS idx_lottery_catalog_name 
    ON public.lottery_catalog (name);

CREATE INDEX IF NOT EXISTS idx_lottery_catalog_is_active 
    ON public.lottery_catalog (is_active);

CREATE INDEX IF NOT EXISTS idx_lottery_results_lottery_id 
    ON public.lottery_results (lottery_id);

CREATE INDEX IF NOT EXISTS idx_lottery_results_lookup 
    ON public.lottery_results (lottery_id, draw_date, draw_time);

CREATE INDEX IF NOT EXISTS idx_lottery_results_draw_date 
    ON public.lottery_results (draw_date DESC);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.lottery_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_results ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on lottery_catalog" ON public.lottery_catalog;
CREATE POLICY "Allow authenticated read on lottery_catalog"
    ON public.lottery_catalog
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on lottery_results" ON public.lottery_results;
CREATE POLICY "Allow authenticated read on lottery_results"
    ON public.lottery_results
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on lottery_catalog" ON public.lottery_catalog;
CREATE POLICY "Allow service_role full access on lottery_catalog"
    ON public.lottery_catalog
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on lottery_results" ON public.lottery_results;
CREATE POLICY "Allow service_role full access on lottery_results"
    ON public.lottery_results
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Triggers de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_lottery_catalog_updated_at ON public.lottery_catalog;
        CREATE TRIGGER set_lottery_catalog_updated_at
            BEFORE UPDATE ON public.lottery_catalog
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

        DROP TRIGGER IF EXISTS set_lottery_results_updated_at ON public.lottery_results;
        CREATE TRIGGER set_lottery_results_updated_at
            BEFORE UPDATE ON public.lottery_results
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;

-- 7. Seed Data: 4 Loterías Iniciales (Leidsa, Lotería Nacional, Real, Gana Más)
INSERT INTO public.lottery_catalog (name, country, official_url, draw_times, extraction_rules, is_active)
VALUES
    (
        'Leidsa',
        'DO',
        'https://leidsa.com',
        '["20:55"]'::jsonb,
        '{"provider": "leidsa", "type": "quiniela"}'::jsonb,
        true
    ),
    (
        'Lotería Nacional',
        'DO',
        'https://loterianacional.gob.do',
        '["21:00"]'::jsonb,
        '{"provider": "nacional", "type": "quiniela"}'::jsonb,
        true
    ),
    (
        'Real',
        'DO',
        'https://loteriareal.com.do',
        '["12:55"]'::jsonb,
        '{"provider": "real", "type": "quiniela"}'::jsonb,
        true
    ),
    (
        'Gana Más',
        'DO',
        'https://loterianacional.gob.do',
        '["14:30"]'::jsonb,
        '{"provider": "nacional", "type": "gana_mas"}'::jsonb,
        true
    )
ON CONFLICT (name) DO UPDATE SET
    country = EXCLUDED.country,
    official_url = EXCLUDED.official_url,
    draw_times = EXCLUDED.draw_times,
    extraction_rules = EXCLUDED.extraction_rules,
    is_active = EXCLUDED.is_active,
    updated_at = now();
