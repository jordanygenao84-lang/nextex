-- ==============================================================================
-- Migración: RLS Restrictivo en Tablas de Negocio (FIX-SEG-2)
-- Reemplaza SELECT abierto USING (true) para authenticated por:
--   super_admin (profiles.is_super_admin = true)
--   O miembro del workspace dueño de la fila (vía workspace_id directo o clients.workspace_id)
-- Excepción explícita:
--   - client_site_keys: solo super_admin en SELECT (los sitios autentican por service_role)
--   - Se mantienen públicas únicamente lottery_catalog y lottery_results
-- Sin tocar columnas ni triggers.
-- ==============================================================================

DO $$
DECLARE
    v_has_conv_client_id BOOLEAN;
    v_has_conv_workspace_id BOOLEAN;
    t TEXT;
    v_has_table BOOLEAN;
    v_has_client_id BOOLEAN;
    v_has_workspace_id BOOLEAN;
    v_is_nullable_client_id BOOLEAN;
    v_cond TEXT;
BEGIN
    -- 1. clients (workspace_id directo)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "clients read" ON public.clients;
        DROP POLICY IF EXISTS "Allow authenticated read on clients" ON public.clients;
        CREATE POLICY "Allow authenticated read on clients"
            ON public.clients
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.is_super_admin = true
                )
                OR public.is_workspace_member(workspace_id, auth.uid())
                OR EXISTS (
                    SELECT 1 FROM public.workspaces w
                    WHERE w.id = workspace_id AND w.owner_id = auth.uid()
                )
            );
    END IF;

    -- 2. conversations y conversation_messages (soporta esquema con workspace_id directo o con client_id)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations') THEN
        ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Allow authenticated read on conversations" ON public.conversations;
        DROP POLICY IF EXISTS "conversations_select_member" ON public.conversations;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'client_id'
        ) INTO v_has_conv_client_id;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'workspace_id'
        ) INTO v_has_conv_workspace_id;

        IF v_has_conv_client_id AND v_has_conv_workspace_id THEN
            EXECUTE $sql$
                CREATE POLICY "Allow authenticated read on conversations"
                    ON public.conversations
                    FOR SELECT
                    TO authenticated
                    USING (
                        EXISTS (
                            SELECT 1 FROM public.profiles p
                            WHERE p.id = auth.uid() AND p.is_super_admin = true
                        )
                        OR (
                            workspace_id IS NOT NULL AND (
                                public.is_workspace_member(workspace_id, auth.uid())
                                OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
                            )
                        )
                        OR (
                            client_id IS NOT NULL AND EXISTS (
                                SELECT 1 FROM public.clients c
                                WHERE c.id = conversations.client_id
                                  AND (
                                      public.is_workspace_member(c.workspace_id, auth.uid())
                                      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())
                                  )
                            )
                        )
                    )
            $sql$;
        ELSIF v_has_conv_client_id THEN
            EXECUTE $sql$
                CREATE POLICY "Allow authenticated read on conversations"
                    ON public.conversations
                    FOR SELECT
                    TO authenticated
                    USING (
                        EXISTS (
                            SELECT 1 FROM public.profiles p
                            WHERE p.id = auth.uid() AND p.is_super_admin = true
                        )
                        OR EXISTS (
                            SELECT 1 FROM public.clients c
                            WHERE c.id = conversations.client_id
                              AND (
                                  public.is_workspace_member(c.workspace_id, auth.uid())
                                  OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())
                              )
                        )
                    )
            $sql$;
        ELSIF v_has_conv_workspace_id THEN
            EXECUTE $sql$
                CREATE POLICY "Allow authenticated read on conversations"
                    ON public.conversations
                    FOR SELECT
                    TO authenticated
                    USING (
                        EXISTS (
                            SELECT 1 FROM public.profiles p
                            WHERE p.id = auth.uid() AND p.is_super_admin = true
                        )
                        OR public.is_workspace_member(workspace_id, auth.uid())
                        OR EXISTS (
                            SELECT 1 FROM public.workspaces w
                            WHERE w.id = workspace_id AND w.owner_id = auth.uid()
                        )
                    )
            $sql$;
        END IF;

        -- conversation_messages (vía conversations)
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversation_messages') THEN
            ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS "Allow authenticated read on conversation_messages" ON public.conversation_messages;

            IF v_has_conv_client_id THEN
                EXECUTE $sql$
                    CREATE POLICY "Allow authenticated read on conversation_messages"
                        ON public.conversation_messages
                        FOR SELECT
                        TO authenticated
                        USING (
                            EXISTS (
                                SELECT 1 FROM public.profiles p
                                WHERE p.id = auth.uid() AND p.is_super_admin = true
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM public.conversations conv
                                JOIN public.clients c ON c.id = conv.client_id
                                WHERE conv.id = conversation_messages.conversation_id
                                  AND (
                                      public.is_workspace_member(c.workspace_id, auth.uid())
                                      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())
                                  )
                            )
                        )
                $sql$;
            ELSIF v_has_conv_workspace_id THEN
                EXECUTE $sql$
                    CREATE POLICY "Allow authenticated read on conversation_messages"
                        ON public.conversation_messages
                        FOR SELECT
                        TO authenticated
                        USING (
                            EXISTS (
                                SELECT 1 FROM public.profiles p
                                WHERE p.id = auth.uid() AND p.is_super_admin = true
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM public.conversations conv
                                WHERE conv.id = conversation_messages.conversation_id
                                  AND (
                                      public.is_workspace_member(conv.workspace_id, auth.uid())
                                      OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = conv.workspace_id AND w.owner_id = auth.uid())
                                  )
                            )
                        )
                $sql$;
            END IF;
        END IF;
    END IF;

    -- 3. client_site_keys: SOLO super_admin en SELECT (los sitios autentican por service_role)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_site_keys') THEN
        ALTER TABLE public.client_site_keys ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Allow authenticated read on client_site_keys" ON public.client_site_keys;
        CREATE POLICY "Allow authenticated read on client_site_keys"
            ON public.client_site_keys
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.is_super_admin = true
                )
            );
    END IF;

    -- 4. ticket_messages (vía support_tickets -> clients.workspace_id)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_messages') THEN
        ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Allow authenticated read on ticket_messages" ON public.ticket_messages;
        CREATE POLICY "Allow authenticated read on ticket_messages"
            ON public.ticket_messages
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.is_super_admin = true
                )
                OR EXISTS (
                    SELECT 1
                    FROM public.support_tickets st
                    JOIN public.clients c ON c.id = st.client_id
                    WHERE st.id = ticket_messages.ticket_id
                      AND (
                          public.is_workspace_member(c.workspace_id, auth.uid())
                          OR EXISTS (
                              SELECT 1 FROM public.workspaces w
                              WHERE w.id = c.workspace_id AND w.owner_id = auth.uid()
                          )
                      )
                )
            );
    END IF;

    -- 5. Tablas de negocio con client_id o workspace_id
    FOREACH t IN ARRAY ARRAY[
        'client_invoices',
        'client_subscriptions',
        'business_metrics',
        'credentials_inventory',
        'backup_configs',
        'backup_runs',
        'domains',
        'deployments',
        'knowledge_entries',
        'support_tickets',
        'error_events',
        'incident_log',
        'security_events',
        'security_findings',
        'site_health_checks',
        'client_id_bindings',
        'client_widgets',
        'client_integrations',
        'client_role_permissions',
        'client_ai_config',
        'client_api_keys',
        'client_ai_audit',
        'response_cache',
        'token_usage',
        'workspace_invites'
    ]
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) INTO v_has_table;

        IF v_has_table THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow authenticated read on ' || t, t);
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read', t);

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'client_id'
            ) INTO v_has_client_id;

            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'workspace_id'
            ) INTO v_has_workspace_id;

            IF v_has_client_id THEN
                SELECT (is_nullable = 'YES')
                INTO v_is_nullable_client_id
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'client_id';

                IF v_is_nullable_client_id THEN
                    v_cond := format(
                        'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true) ' ||
                        'OR (%I.client_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = %I.client_id AND (public.is_workspace_member(c.workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid()))))',
                        t, t
                    );
                ELSE
                    v_cond := format(
                        'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true) ' ||
                        'OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = %I.client_id AND (public.is_workspace_member(c.workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())))',
                        t
                    );
                END IF;

                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                    'Allow authenticated read on ' || t,
                    t,
                    v_cond
                );
            ELSIF v_has_workspace_id THEN
                v_cond := format(
                    'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true) ' ||
                    'OR public.is_workspace_member(%I.workspace_id, auth.uid()) ' ||
                    'OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = %I.workspace_id AND w.owner_id = auth.uid())',
                    t, t
                );

                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                    'Allow authenticated read on ' || t,
                    t,
                    v_cond
                );
            END IF;
        END IF;
    END LOOP;
END $$;
