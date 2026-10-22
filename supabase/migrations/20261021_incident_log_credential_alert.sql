-- ==============================================================================
-- Migración: Ampliar CHECK de incident_log.kind agregando 'credential_alert' (NIV1-2)
-- ==============================================================================

ALTER TABLE public.incident_log
    DROP CONSTRAINT IF EXISTS incident_log_kind_check;

ALTER TABLE public.incident_log
    ADD CONSTRAINT incident_log_kind_check
    CHECK (kind IN (
        'health_down',
        'health_recovered',
        'attack_detected',
        'finding_opened',
        'finding_fixed',
        'consumption_spike',
        'credential_alert'
    ));
