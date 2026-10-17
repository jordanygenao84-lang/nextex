-- ==============================================================================
-- Migración: Client Connections (Site Keys & ID Bindings)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: client_site_keys
CREATE TABLE IF NOT EXISTS public.client_site_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla: client_id_bindings
CREATE TABLE IF NOT EXISTS public.client_id_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    phone TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp', 'instagram', 'other')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_id_bindings_client_external_channel_key UNIQUE (client_id, external_id, channel)
);

-- 3. Índices para acelerar búsquedas
CREATE INDEX IF NOT EXISTS idx_client_site_keys_client_id 
    ON public.client_site_keys (client_id);

CREATE INDEX IF NOT EXISTS idx_client_site_keys_prefix 
    ON public.client_site_keys (key_prefix);

CREATE INDEX IF NOT EXISTS idx_client_id_bindings_client_id 
    ON public.client_id_bindings (client_id);

CREATE INDEX IF NOT EXISTS idx_client_id_bindings_lookup 
    ON public.client_id_bindings (client_id, channel, external_id);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.client_site_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_id_bindings ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on client_site_keys" ON public.client_site_keys;
CREATE POLICY "Allow authenticated read on client_site_keys"
    ON public.client_site_keys
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on client_id_bindings" ON public.client_id_bindings;
CREATE POLICY "Allow authenticated read on client_id_bindings"
    ON public.client_id_bindings
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on client_site_keys" ON public.client_site_keys;
CREATE POLICY "Allow service_role full access on client_site_keys"
    ON public.client_site_keys
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on client_id_bindings" ON public.client_id_bindings;
CREATE POLICY "Allow service_role full access on client_id_bindings"
    ON public.client_id_bindings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Triggers de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_client_site_keys_updated_at ON public.client_site_keys;
        CREATE TRIGGER set_client_site_keys_updated_at
            BEFORE UPDATE ON public.client_site_keys
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

        DROP TRIGGER IF EXISTS set_client_id_bindings_updated_at ON public.client_id_bindings;
        CREATE TRIGGER set_client_id_bindings_updated_at
            BEFORE UPDATE ON public.client_id_bindings
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
