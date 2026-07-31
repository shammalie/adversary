-- Geo catalogue: mined OpenMapTiles seed tables (system of record).

CREATE TABLE geo_seed_meta (
    id              BIGSERIAL PRIMARY KEY,
    schema_v        INT NOT NULL DEFAULT 1,
    generated_at    TIMESTAMPTZ,
    mbtiles_path    TEXT NOT NULL DEFAULT '',
    mbtiles_source_url TEXT NOT NULL DEFAULT '',
    job_status      TEXT NOT NULL DEFAULT 'idle'
                        CHECK (job_status IN ('idle', 'running', 'succeeded', 'failed')),
    error           TEXT NOT NULL DEFAULT '',
    aerodrome_count INT NOT NULL DEFAULT 0,
    port_count      INT NOT NULL DEFAULT 0,
    sea_lane_count  INT NOT NULL DEFAULT 0,
    road_anchor_count INT NOT NULL DEFAULT 0,
    region_count    INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Singleton row for current catalogue meta (id=1); job history can append later.
INSERT INTO geo_seed_meta (id, job_status) VALUES (1, 'idle');

CREATE TABLE geo_reseed_jobs (
    id           UUID PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    mbtiles_path TEXT NOT NULL DEFAULT '',
    progress     TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT '',
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE geo_regions (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    west     DOUBLE PRECISION NOT NULL,
    south    DOUBLE PRECISION NOT NULL,
    east     DOUBLE PRECISION NOT NULL,
    north    DOUBLE PRECISION NOT NULL,
    bbox     geography(Polygon, 4326) NOT NULL,
    supports TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX geo_regions_bbox_gix ON geo_regions USING GIST (bbox);

CREATE TABLE geo_aerodromes (
    id      BIGSERIAL PRIMARY KEY,
    icao    TEXT NOT NULL DEFAULT '',
    iata    TEXT NOT NULL DEFAULT '',
    name    TEXT NOT NULL DEFAULT '',
    class   TEXT NOT NULL DEFAULT '',
    ele_ft  INT NOT NULL DEFAULT 0,
    geom    geography(Point, 4326) NOT NULL,
    runways JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX geo_aerodromes_icao_uidx
    ON geo_aerodromes (icao)
    WHERE icao <> '';

CREATE INDEX geo_aerodromes_geom_gix ON geo_aerodromes USING GIST (geom);

CREATE TABLE geo_ports (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    geom geography(Point, 4326) NOT NULL
);

CREATE INDEX geo_ports_geom_gix ON geo_ports USING GIST (geom);

CREATE TABLE geo_sea_lanes (
    id   BIGSERIAL PRIMARY KEY,
    geom geography(Point, 4326) NOT NULL
);

CREATE INDEX geo_sea_lanes_geom_gix ON geo_sea_lanes USING GIST (geom);

CREATE TABLE geo_road_anchors (
    id        BIGSERIAL PRIMARY KEY,
    region_id TEXT NOT NULL REFERENCES geo_regions (id) ON DELETE CASCADE,
    geom      geography(Point, 4326) NOT NULL
);

CREATE INDEX geo_road_anchors_geom_gix ON geo_road_anchors USING GIST (geom);
CREATE INDEX geo_road_anchors_region_idx ON geo_road_anchors (region_id);
