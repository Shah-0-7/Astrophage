'use client';

import type { FieldMeta } from '@/lib/displacement/field';
import { fmtRangeCm } from '@/lib/displacement/match';
import { useMeasuredSummary } from '@/lib/useMeasured';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The measured NISAR ground motion for an event: headline range, the pair it comes from, and how to read it. */
export function MeasuredDisplacement({ meta, count = 1, variant = 'row' }: { meta: FieldMeta; count?: number; variant?: 'row' | 'card' }) {
  const s = useMeasuredSummary(meta.id);
  const pass = meta.direction === 'A' ? 'ascending' : meta.direction === 'D' ? 'descending' : null;
  const detail = `NISAR L-band, ${day(meta.reference)} → ${day(meta.secondary)}${meta.track != null ? `, track ${meta.track}` : ''}${meta.frame != null ? ` frame ${meta.frame}` : ''}${pass ? `, ${pass}` : ''} · ${meta.maturity.toLowerCase()} product${count > 1 ? ` · ${count - 1} more pair${count > 2 ? 's' : ''} in the 3D view` : ''}`;
  const caveat = 'Line-of-sight change (+ toward the satellite), 2nd to 98th percentile. Not vertical motion; relative to the edge of the processed window; atmosphere not corrected.';
  const headline = s === undefined ? 'READING…' : s === null ? 'UNAVAILABLE' : fmtRangeCm(s.lo, s.hi);
  if (variant === 'card') {
    return (
      <section className="rp-card rp-disp rp-measured">
        <h3>SURFACE DISPLACEMENT · MEASURED BY NISAR</h3>
        <div className="rp-big">{headline}</div>
        <p>{detail}</p>
        <small>{caveat}</small>
      </section>
    );
  }
  return (
    <div className="lg-wide lg-measured">
      <dt>Surface displacement · measured by NISAR</dt>
      <dd>{headline}</dd>
      <small>{detail}</small>
      <small>{caveat}</small>
    </div>
  );
}
