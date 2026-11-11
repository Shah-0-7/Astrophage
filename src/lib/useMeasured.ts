'use client';

import { useEffect, useState } from 'react';
import { decodeField, fieldStats, type FieldMeta, type FieldWire } from '@/lib/displacement/field';

const INDEX_TTL_MS = 5 * 60_000;
let index: { at: number; p: Promise<FieldMeta[]> } | null = null;

/** One request for every grid the site holds, shared by every event row. Empty when there is no database or nothing processed. */
export function loadMeasuredIndex(): Promise<FieldMeta[]> {
  if (index && Date.now() - index.at < INDEX_TTL_MS) return index.p;
  const p = fetch('/api/displacement?all=1')
    .then(r => (r.ok ? r.json() : { configured: false, fields: [] }))
    .then((j: { configured?: boolean; fields?: FieldMeta[] }) => (j.configured && Array.isArray(j.fields) ? j.fields : []))
    .catch(() => [] as FieldMeta[]);
  index = { at: Date.now(), p };
  return p;
}

export function useMeasuredIndex(): FieldMeta[] {
  const [metas, setMetas] = useState<FieldMeta[]>([]);
  useEffect(() => { let alive = true; loadMeasuredIndex().then(m => { if (alive) setMetas(m); }); return () => { alive = false; }; }, []);
  return metas;
}

/** The same index, plus whether the request has finished (so a page can tell "loading" from "nothing processed"). */
export function useMeasuredIndexState(): { metas: FieldMeta[]; loaded: boolean } {
  const [state, setState] = useState<{ metas: FieldMeta[]; loaded: boolean }>({ metas: [], loaded: false });
  useEffect(() => { let alive = true; loadMeasuredIndex().then(m => { if (alive) setState({ metas: m, loaded: true }); }); return () => { alive = false; }; }, []);
  return state;
}

export interface MeasuredSummary {
  /** 2nd and 98th percentile of line-of-sight change, cm (+ toward the satellite) */
  lo: number;
  hi: number;
  coverage: number;
}

const summaries = new Map<string, Promise<MeasuredSummary | null>>();

function loadSummary(id: string): Promise<MeasuredSummary | null> {
  let p = summaries.get(id);
  if (!p) {
    p = fetch(`/api/displacement?id=${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((w: FieldWire | null) => {
        if (!w) return null;
        const s = fieldStats(decodeField(w));
        return s ? { lo: s.p2, hi: s.p98, coverage: s.coverage } : null;
      })
      .catch(() => null);
    summaries.set(id, p);
    p.then(v => { if (v === null) summaries.delete(id); }); // retry a failed one next time
  }
  return p;
}

/** The headline numbers of one grid, fetched when first asked for (grids are ~150 KB, so rows load them only when opened). */
export function useMeasuredSummary(id: string | null): MeasuredSummary | null | undefined {
  const [s, setS] = useState<MeasuredSummary | null | undefined>(undefined);
  useEffect(() => {
    if (!id) { setS(undefined); return; }
    let alive = true;
    setS(undefined);
    loadSummary(id).then(v => { if (alive) setS(v); });
    return () => { alive = false; };
  }, [id]);
  return s;
}
