-- Indexed target positions for viewport PostGIS envelope queries (Phase 5).
-- Synced from run_checkpoints.target_states on each checkpoint write.

CREATE TABLE run_target_positions (
    run_id     UUID NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    target_id  TEXT NOT NULL,
    callsign   TEXT NOT NULL DEFAULT '',
    color      TEXT NOT NULL DEFAULT '',
    revealed   BOOLEAN NOT NULL DEFAULT false,
    appeared   BOOLEAN NOT NULL DEFAULT false,
    geom       geography(Point, 4326),
    position   JSONB,
    trail      JSONB NOT NULL DEFAULT '[]'::jsonb,
    state      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, target_id)
);

CREATE INDEX run_target_positions_geom_idx
    ON run_target_positions USING GIST (geom);

CREATE INDEX run_target_positions_run_id_idx
    ON run_target_positions (run_id);
