-- Measured ground-motion grids derived from NISAR interferograms (see tools/nisar-grid).
-- One row per source granule. `body` is the compact JSON grid (int16 line-of-sight values), at most a few hundred KB.
CREATE TABLE IF NOT EXISTS displacement_fields (
  id          TEXT PRIMARY KEY,
  maturity    TEXT NOT NULL,
  west        REAL NOT NULL,
  south       REAL NOT NULL,
  east        REAL NOT NULL,
  north       REAL NOT NULL,
  ref_ms      INTEGER NOT NULL,
  sec_ms      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  body        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS displacement_fields_time ON displacement_fields (ref_ms, sec_ms);
