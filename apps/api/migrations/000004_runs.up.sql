-- Server-owned runs with checkpoints and Postgres leases.

CREATE TABLE runs (
    id                   UUID PRIMARY KEY,
    scenario_id          UUID NOT NULL REFERENCES scenarios (id) ON DELETE RESTRICT,
    status               TEXT NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running', 'stopped', 'completed')),
    start_at             TIMESTAMPTZ NOT NULL,
    schedule_offset_ms   BIGINT NOT NULL DEFAULT 0,
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at           TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX runs_status_idx ON runs (status);
CREATE INDEX runs_scenario_id_idx ON runs (scenario_id);
CREATE INDEX runs_started_at_idx ON runs (started_at DESC);

CREATE TABLE run_checkpoints (
    run_id               UUID PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
    processed_event_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ingested_events      JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_states        JSONB NOT NULL DEFAULT '{}'::jsonb,
    critical_alert_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_event_at        TIMESTAMPTZ,
    last_reconciled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    runtime_status       TEXT NOT NULL DEFAULT 'running',
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_leases (
    run_id               UUID PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
    owner_instance_id    TEXT NOT NULL,
    expires_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX run_leases_expires_at_idx ON run_leases (expires_at);
