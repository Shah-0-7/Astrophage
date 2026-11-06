'use client';

import { useEffect, useState } from 'react';
import type { CoverageResponse } from '@/lib/nisar/api';

export type CoverageState = { phase: 'loading' } | { phase: 'failed' } | { phase: 'done'; data: CoverageResponse };

// Shared between the ledger and the report so opening both never asks NASA twice.
const done = new Map<string, CoverageResponse>();
const inflight = new Map<string, Promise<CoverageResponse | null>>();

function load(key: string, url: string): Promise<CoverageResponse | null> {
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = fetch(url).then(r => (r.ok ? (r.json() as Promise<CoverageResponse>) : null)).catch(() => null).then(d => {
      inflight.delete(key);
      if (d && d.status !== 'unavailable') done.set(key, d); // an outage is not remembered, so a retry can succeed
      return d;
    });
    inflight.set(key, p);
  }
  return p;
}

/** What NASA's catalogue says NISAR has observed at an event, and which interferograms may contain it. */
export function useNisarCoverage(event: { lat: number; lon: number; time: number } | null, enabled = true): CoverageState {
  const [state, setState] = useState<CoverageState>({ phase: 'loading' });
  const lat = event?.lat, lon = event?.lon, time = event?.time;
  useEffect(() => {
    if (!enabled || lat == null || lon == null || time == null) return;
    let alive = true;
    setState({ phase: 'loading' });
    // Rounded so events a few hundred metres apart share a request.
    const q = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&time=${Math.round(time / 60_000) * 60_000}`;
    load(q, `/api/nisar/coverage?${q}`).then(d => { if (alive) setState(d ? { phase: 'done', data: d } : { phase: 'failed' }); });
    return () => { alive = false; };
  }, [lat, lon, time, enabled]);
  return state;
}
