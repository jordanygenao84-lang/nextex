-- ==============================================================================
-- Migración: Client Role Permissions (Granular RBAC per Client)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: client_role_permissions
CREATE TABLE IF NOT EXISTS public.client_role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    section TEXT NOT NULL CHECK (section IN ('conversaciones', 'automatizaciones', 'consumo', 'config_ia', 'usuarios')),
    action TEXT NOT NULL CHECK (action IN ('ver', 'responder', 'pausar', 'editar', 'invitar')),
    allowed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_role_permissions_client_role_section_action_key UNIQUE (client_id, role, section, action)
);

-- 2. Índices para acelerar búsquedas y evaluaciones de permisos
CREATE INDEX IF NOT EXISTS idx_client_role_permissions_client_id 
    ON public.client_role_permissions (client_id);

CREATE INDEX IF NOT EXISTS idx_client_role_permissions_lookup 
    ON public.client_role_permissions (client_id, role, section, action);

-- 3. Habilitar RLS en la tabla
ALTER TABLE public.client_role_permissions ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on client_role_permissions" ON public.client_role_permissions;
CREATE POLICY "Allow authenticated read on client_role_permissions"
    ON public.client_role_permissions
    FOR SELECT
    TO authenticated
    USING (true);

-- Política de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on client_role_permissions" ON public.client_role_permissions;
CREATE POLICY "Allow service_role full access on client_role_permissions"
    ON public.client_role_permissions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Trigger de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_client_role_permissions_updated_at ON public.client_role_permissions;
        CREATE TRIGGER set_client_role_permissions_updated_at
            BEFORE UPDATE ON public.client_role_permissions
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
