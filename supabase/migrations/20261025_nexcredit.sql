-- ==============================================================================
-- Migración: Registro de NEXCREDIT (Marca Capitalia) y Respaldo (NEXCREDIT-1B)
-- Cliente: NEXCREDIT (https://capitalia-beta.vercel.app)
-- Respaldo: Supabase proyecto capitalia; sin repo GitHub (solo db.json)
-- ==============================================================================

DO $$
DECLARE
    v_owner_id UUID;
    v_workspace_id UUID;
    v_client_id UUID;
BEGIN
    -- 1. Resolver el owner (is_super_admin en profiles o propietario existente en workspaces)
    SELECT id INTO v_owner_id
    FROM public.profiles
    WHERE is_super_admin = true
    LIMIT 1;

    IF v_owner_id IS NULL THEN
        SELECT owner_id INTO v_owner_id
        FROM public.workspaces
        WHERE owner_id IS NOT NULL
        LIMIT 1;
    END IF;

    IF v_owner_id IS NULL THEN
        SELECT id INTO v_owner_id
        FROM auth.users
        LIMIT 1;
    END IF;

    -- 2. Verificar si el cliente NEXCREDIT ya existe
    SELECT id, workspace_id
    INTO v_client_id, v_workspace_id
    FROM public.clients
    WHERE UPPER(TRIM(display_name)) = 'NEXCREDIT'
    LIMIT 1;

    IF v_client_id IS NULL THEN
        -- Crear workspace dedicado para NEXCREDIT
        INSERT INTO public.workspaces (name, slug, owner_id, is_personal)
        VALUES (
            'NEXCREDIT',
            'nexcredit-capitalia-' || substr(md5(random()::text), 1, 6),
            v_owner_id,
            false
        )
        RETURNING id INTO v_workspace_id;

        -- Registrar membresía owner si existe usuario
        IF v_owner_id IS NOT NULL THEN
            INSERT INTO public.workspace_members (workspace_id, user_id, role)
            VALUES (v_workspace_id, v_owner_id, 'owner')
            ON CONFLICT DO NOTHING;
        END IF;

        -- Crear el cliente NEXCREDIT (marca Capitalia)
        INSERT INTO public.clients (
            workspace_id,
            display_name,
            website_url,
            status,
            notes,
            created_at,
            updated_at
        )
        VALUES (
            v_workspace_id,
            'NEXCREDIT',
            'https://capitalia-beta.vercel.app',
            'active',
            'Marca: Capitalia',
            now(),
            now()
        )
        RETURNING id INTO v_client_id;
    ELSE
        -- Asegurar datos actualizados si ya existía
        UPDATE public.clients
        SET website_url = 'https://capitalia-beta.vercel.app',
            status = 'active',
            notes = COALESCE(NULLIF(TRIM(notes), ''), 'Marca: Capitalia'),
            updated_at = now()
        WHERE id = v_client_id;
    END IF;

    -- 3. Configurar respaldo: Supabase proyecto capitalia; sin repo GitHub (solo db.json)
    INSERT INTO public.backup_configs (
        client_id,
        supabase_url,
        github_repo,
        github_branch,
        github_token_encrypted,
        enabled,
        created_at,
        updated_at
    )
    VALUES (
        v_client_id,
        'https://kctmkhilflewakjcdnvw.supabase.co',
        NULL,
        'main',
        NULL,
        true,
        now(),
        now()
    )
    ON CONFLICT (client_id) DO UPDATE
    SET supabase_url = 'https://kctmkhilflewakjcdnvw.supabase.co',
        github_repo = NULL,
        github_token_encrypted = NULL,
        enabled = true,
        updated_at = now();
END $$;
