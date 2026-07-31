-- Scenario store: drafts in JSONB payload; normalized targets/events when ready.

CREATE TABLE scenarios (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready')),
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_version  INT NOT NULL DEFAULT 2,
    owner_user_id   UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scenarios_status_idx ON scenarios (status);
CREATE INDEX scenarios_updated_at_idx ON scenarios (updated_at DESC);
CREATE INDEX scenarios_owner_user_id_idx ON scenarios (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE TABLE targets (
    scenario_id              UUID NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    id                       TEXT NOT NULL,
    callsign                 TEXT NOT NULL DEFAULT '',
    reveal_on_first_event    BOOLEAN NOT NULL DEFAULT false,
    appear_on_first_event    BOOLEAN NOT NULL DEFAULT false,
    color                    TEXT NOT NULL DEFAULT '#ffffff',
    profile                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_cruise_knots         DOUBLE PRECISION,
    definition               JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (scenario_id, id)
);

CREATE INDEX targets_scenario_id_idx ON targets (scenario_id);

CREATE TABLE events (
    scenario_id UUID NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    at          TIMESTAMPTZ NOT NULL,
    fires_at    TIMESTAMPTZ,
    position    JSONB,
    message     TEXT,
    definition  JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (scenario_id, id),
    FOREIGN KEY (scenario_id, target_id) REFERENCES targets (scenario_id, id) ON DELETE CASCADE
);

CREATE INDEX events_scenario_at_idx ON events (scenario_id, at);
CREATE INDEX events_scenario_target_idx ON events (scenario_id, target_id);

CREATE TABLE usage_events (
    id           BIGSERIAL PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id      UUID,
    event_type   TEXT NOT NULL,
    scenario_id  UUID,
    run_id       UUID,
    properties   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX usage_events_occurred_at_idx ON usage_events (occurred_at DESC);
CREATE INDEX usage_events_event_type_idx ON usage_events (event_type);
CREATE INDEX usage_events_scenario_id_idx ON usage_events (scenario_id)
    WHERE scenario_id IS NOT NULL;
