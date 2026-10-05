-- ============================================================
-- PostGIS Setup Script – NISAR Spatial Analytics Database
-- ============================================================
-- Run automatically on first container start via docker-entrypoint-initdb.d
-- ============================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- for text search

-- ── Seismic Events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seismic_events (
  id            TEXT PRIMARY KEY,
  magnitude     NUMERIC(4,2) NOT NULL,
  place         TEXT,
  depth_km      NUMERIC(8,3),
  tsunami       SMALLINT DEFAULT 0,
  sig           INTEGER DEFAULT 0,
  event_time    TIMESTAMPTZ NOT NULL,
  url           TEXT,
  event_subtype TEXT CHECK (event_subtype IN ('INTERPLATE', 'INTRAPLATE')),
  geom          GEOMETRY(Point, 4326) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seismic_events_geom
  ON seismic_events USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_seismic_events_time
  ON seismic_events (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_seismic_events_magnitude
  ON seismic_events (magnitude DESC);

-- ── PB2002 Fault Lines ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fault_lines (
  id        SERIAL PRIMARY KEY,
  name      TEXT,
  type      TEXT,  -- 'subduction', 'transform', 'divergent', etc.
  geom      GEOMETRY(MultiLineString, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fault_lines_geom
  ON fault_lines USING GIST(geom);

-- ── GNSS Stations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gnss_stations (
  id            TEXT PRIMARY KEY,
  network       TEXT,
  name          TEXT,
  lat           NUMERIC(9,6),
  lon           NUMERIC(9,6),
  deformation_rate_mm_yr NUMERIC(8,3),
  last_updated  TIMESTAMPTZ,
  geom          GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gnss_stations_geom
  ON gnss_stations USING GIST(geom);

-- ── Sentinel-1 Swaths ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sentinel_swaths (
  id            TEXT PRIMARY KEY,
  acquisition   TIMESTAMPTZ NOT NULL,
  orbit_dir     TEXT CHECK (orbit_dir IN ('ASC', 'DESC')),
  track         INTEGER,
  polarisation  TEXT,
  geom          GEOMETRY(Polygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sentinel_swaths_geom
  ON sentinel_swaths USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_sentinel_swaths_acq
  ON sentinel_swaths (acquisition DESC);

-- ── Volcano Alerts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS volcano_alerts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  country       TEXT,
  aviation_color TEXT CHECK (aviation_color IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
  alert_level   TEXT,
  last_eruption TEXT,
  activity      TEXT,
  last_updated  TIMESTAMPTZ,
  geom          GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volcano_alerts_geom
  ON volcano_alerts USING GIST(geom);

-- ── Sea Ice Extent ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sea_ice_extent (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  hemisphere    TEXT CHECK (hemisphere IN ('N', 'S')),
  extent_sq_km  NUMERIC(12,2),
  anomaly_sq_km NUMERIC(12,2),
  geom          GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX IF NOT EXISTS idx_sea_ice_date
  ON sea_ice_extent (date DESC, hemisphere);

-- ── Tsunami Warnings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tsunami_warnings (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  severity      TEXT CHECK (severity IN ('WATCH', 'WARNING', 'ADVISORY', 'INFO')),
  issued_at     TIMESTAMPTZ NOT NULL,
  event_id      TEXT REFERENCES seismic_events(id) ON DELETE SET NULL,
  geom          GEOMETRY(Polygon, 4326)  -- marine threat zone
);

CREATE INDEX IF NOT EXISTS idx_tsunami_warnings_geom
  ON tsunami_warnings USING GIST(geom);

-- ── Materialized view: seismic events tagged by fault proximity ─
CREATE MATERIALIZED VIEW IF NOT EXISTS seismic_tagged AS
SELECT
  e.id,
  e.magnitude,
  e.place,
  e.depth_km,
  e.tsunami,
  e.sig,
  e.event_time,
  e.url,
  e.geom,
  nearest.distance_m,
  nearest.fault_name,
  CASE
    WHEN nearest.distance_m < 50000 THEN 'INTERPLATE'
    ELSE 'INTRAPLATE'
  END AS event_subtype
FROM seismic_events e
CROSS JOIN LATERAL (
  SELECT
    ST_Distance(e.geom::geography, fl.geom::geography) AS distance_m,
    fl.name AS fault_name
  FROM fault_lines fl
  ORDER BY fl.geom <-> e.geom
  LIMIT 1
) nearest;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seismic_tagged_id
  ON seismic_tagged (id);

CREATE INDEX IF NOT EXISTS idx_seismic_tagged_subtype
  ON seismic_tagged (event_subtype);
