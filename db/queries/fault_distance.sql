-- ============================================================
-- Fault Distance & INTERPLATE/INTRAPLATE Tagging Pipeline
-- ============================================================
-- Uses PostGIS <-> operator for KNN spatial index scan (fast).
-- The 50 km threshold is the standard seismological cutoff for
-- "on-boundary" (INTERPLATE) vs. "interior" (INTRAPLATE).
-- ============================================================

-- Tag a single new event (call from Node.js on insert)
CREATE OR REPLACE FUNCTION tag_seismic_event(p_event_id TEXT)
RETURNS TABLE(event_id TEXT, distance_m FLOAT8, fault_name TEXT, subtype TEXT)
LANGUAGE SQL STABLE AS $$
  SELECT
    e.id AS event_id,
    ST_Distance(e.geom::geography, fl.geom::geography) AS distance_m,
    fl.name  AS fault_name,
    CASE
      WHEN ST_Distance(e.geom::geography, fl.geom::geography) < 50000
      THEN 'INTERPLATE'
      ELSE 'INTRAPLATE'
    END AS subtype
  FROM seismic_events e
  CROSS JOIN LATERAL (
    SELECT geom, name
    FROM   fault_lines
    ORDER BY geom <-> e.geom
    LIMIT  1
  ) fl
  WHERE e.id = p_event_id;
$$;

-- Bulk refresh the materialized view (run nightly via cron)
CREATE OR REPLACE PROCEDURE refresh_seismic_tags()
LANGUAGE SQL AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY seismic_tagged;
$$;

-- Nearest-neighbour query used by the API to enrich live events
-- Returns the 5 closest fault lines with distance to any given point
CREATE OR REPLACE FUNCTION nearest_faults(
  p_lng FLOAT8,
  p_lat FLOAT8,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  fault_id   INT,
  fault_name TEXT,
  fault_type TEXT,
  distance_m FLOAT8
)
LANGUAGE SQL STABLE AS $$
  SELECT
    fl.id        AS fault_id,
    fl.name      AS fault_name,
    fl.type      AS fault_type,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      fl.geom::geography
    ) AS distance_m
  FROM fault_lines fl
  ORDER BY fl.geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
  LIMIT p_limit;
$$;
