'use client';

import { useEffect, useState } from 'react';
import { decodeField, type DisplacementField, type FieldMeta, type FieldWire } from '@/lib/displacement/field';

export type DisplacementState =
  | { status: 'loading' }
  | { status: 'unconfigured' }            // this deployment has no database
  | { status: 'none' }                    // nothing processed for this event yet
  | { status: 'failed' }
  | { status: 'ready'; field: DisplacementField; others: FieldMeta[] };

/** The measured grid (if any) whose date pair spans the event, shortest pair first. `pick` chooses among several. */
export function useDisplacement(event: { lat: number; lon: number; time: number }, pick?: string | null): DisplacementState {
  const [state, setState] = useState<DisplacementState>({ status: 'loading' });
  const { lat, lon, time } = event;
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const r = await fetch(`/api/displacement?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&time=${Math.round(time)}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { configured: boolean; fields: FieldMeta[] };
        if (!alive) return;
        if (!j.configured) { setState({ status: 'unconfigured' }); return; }
        if (!j.fields.length) { setState({ status: 'none' }); return; }
        const chosen = j.fields.find(f => f.id === pick) ?? j.fields[0];
        const g = await fetch(`/api/displacement?id=${encodeURIComponent(chosen.id)}`);
        if (!g.ok) throw new Error(String(g.status));
        const field = decodeField((await g.json()) as FieldWire);
        if (alive) setState({ status: 'ready', field, others: j.fields.filter(f => f.id !== chosen.id) });
      } catch { if (alive) setState({ status: 'failed' }); }
    })();
    return () => { alive = false; };
  }, [lat, lon, time, pick]);
  return state;
}
