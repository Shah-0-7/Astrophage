/**
 * ============================================================
 * useEarthquakeData – Real-time earthquake + fault data hook
 * ============================================================
 * Fetches:
 *   1. USGS FDSN M4.5+ earthquakes via /api/earthquakes proxy
 *   2. PB2002 tectonic plate boundaries (fraxen/tectonicplates)
 *
 * Returns typed, memoized data ready for Deck.gl layers.
 * ============================================================
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FeatureCollection } from 'geojson';

// ── Types ────────────────────────────────────────────────────

export interface USGSEarthquake {
  id: string;
  magnitude: number;
  place: string;
  time: number;        // epoch ms
  updated: number;
  status: string;
  tsunami: number;
  sig: number;         // significance 0-1000
  type: string;
  coords: [number, number, number]; // [lng, lat, depth_km]
  url: string;
  detail: string;
}

export type FaultStatus = 'loading' | 'ok' | 'error';

export interface EarthquakeDataReturn {
  earthquakes: USGSEarthquake[];
  faultLines: FeatureCollection | null;
  status: FaultStatus;
  lastUpdated: Date | null;
  refetch: () => void;
}

// ── PB2002 fault lines (fraxen/tectonicplates, ODbL) ─────────
const PB2002_URL =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';

// ── Parse raw USGS GeoJSON feature into our typed shape ──────
function parseUSGSFeature(f: any): USGSEarthquake | null {
  try {
    const p = f.properties;
    const [lng, lat, depth] = f.geometry.coordinates as [number, number, number];
    return {
      id:        f.id,
      magnitude: p.mag ?? 0,
      place:     p.place ?? 'Unknown',
      time:      p.time ?? 0,
      updated:   p.updated ?? 0,
      status:    p.status ?? '',
      tsunami:   p.tsunami ?? 0,
      sig:       p.sig ?? 0,
      type:      p.type ?? 'earthquake',
      coords:    [lng, lat, depth ?? 0],
      url:       p.url ?? '',
      detail:    p.detail ?? '',
    };
  } catch {
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────

export function useEarthquakeData(minMagnitude = 4.5, limit = 300): EarthquakeDataReturn {
  const [earthquakes, setEarthquakes] = useState<USGSEarthquake[]>([]);
  const [faultLines,  setFaultLines]  = useState<FeatureCollection | null>(null);
  const [status,      setStatus]      = useState<FaultStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick,        setTick]        = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  // Fetch earthquakes from USGS proxy
  useEffect(() => {
    setStatus('loading');
    const url = `/api/earthquakes?minmagnitude=${minMagnitude}&limit=${limit}`;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((geojson: any) => {
        const parsed = (geojson.features ?? [])
          .map(parseUSGSFeature)
          .filter(Boolean) as USGSEarthquake[];
        setEarthquakes(parsed);
        setLastUpdated(new Date());
        setStatus('ok');
      })
      .catch(err => {
        console.error('[useEarthquakeData] USGS fetch error:', err);
        setStatus('error');
      });
  }, [minMagnitude, limit, tick]);

  // Fetch PB2002 fault lines once (cached by browser)
  useEffect(() => {
    fetch(PB2002_URL)
      .then(r => r.json())
      .then((geojson: FeatureCollection) => setFaultLines(geojson))
      .catch(err => console.error('[useEarthquakeData] PB2002 fetch error:', err));
  }, []);

  return { earthquakes, faultLines, status, lastUpdated, refetch };
}
