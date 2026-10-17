-- ==============================================================================
-- Migración: Client Widgets (Embeddable Web Widgets)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: client_widgets
CREATE TABLE IF NOT EXISTS public.client_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    embed_key TEXT NOT NULL UNIQUE,
    allowed_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    theme JSONB NOT NULL DEFAULT '{}'::jsonb,
    greeting TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Índices para acelerar búsquedas
CREATE INDEX IF NOT EXISTS idx_client_widgets_client_id 
    ON public.client_widgets (client_id);

CREATE INDEX IF NOT EXISTS idx_client_widgets_embed_key 
    ON public.client_widgets (embed_key);

-- 3. Habilitar RLS en la tabla
ALTER TABLE public.client_widgets ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on client_widgets" ON public.client_widgets;
CREATE POLICY "Allow authenticated read on client_widgets"
    ON public.client_widgets
    FOR SELECT
    TO authenticated
    USING (true);

-- Política de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on client_widgets" ON public.client_widgets;
CREATE POLICY "Allow service_role full access on client_widgets"
    ON public.client_widgets
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Trigger de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_client_widgets_updated_at ON public.client_widgets;
        CREATE TRIGGER set_client_widgets_updated_at
            BEFORE UPDATE ON public.client_widgets
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
