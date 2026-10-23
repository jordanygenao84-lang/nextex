-- ==============================================================================
-- Migración: Motor de Respaldos (Nivel 1.18) (NIV1-5)
-- Tablas: backup_configs y bucket privado de Storage 'backups'
-- ==============================================================================

-- 1. Tabla: backup_configs (configuraciones de respaldo por cliente)
CREATE TABLE IF NOT EXISTS public.backup_configs (
    client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
    supabase_url TEXT,
    service_key_encrypted TEXT,
    github_repo TEXT,
    github_branch TEXT NOT NULL DEFAULT 'main',
    github_token_encrypted TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices backup_configs
CREATE INDEX IF NOT EXISTS idx_backup_configs_enabled 
    ON public.backup_configs (enabled);

-- 2. Habilitar Row Level Security (RLS)
ALTER TABLE public.backup_configs ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on backup_configs" ON public.backup_configs;
CREATE POLICY "Allow authenticated read on backup_configs"
    ON public.backup_configs
    FOR SELECT
    TO authenticated
    USING (true);

-- 4. Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on backup_configs" ON public.backup_configs;
CREATE POLICY "Allow service_role full access on backup_configs"
    ON public.backup_configs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Bucket privado de Storage: 'backups'
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Políticas de acceso a storage para el bucket 'backups'
DROP POLICY IF EXISTS "Allow service_role full access on backups bucket" ON storage.objects;
CREATE POLICY "Allow service_role full access on backups bucket"
    ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'backups')
    WITH CHECK (bucket_id = 'backups');
