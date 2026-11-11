'use client';

/**
 * The marker drawn on the radar map for the selected event: a rotating reticle with a displacement chip, a red banner naming
 * the event and a small tag for its size. Every value is real or labelled: measured when a processed NISAR grid spans the
 * event, otherwise the modelled estimate, and the label says which.
 */

import { motion } from 'framer-motion';
import type { UnifiedFeature } from '@/lib/types';
import { estimateDisplacement } from '@/lib/eventPhysics';
import { fmtRangeCm, matchFields } from '@/lib/displacement/match';
import { useMeasuredIndex, useMeasuredSummary } from '@/lib/useMeasured';
import { featurePoint } from './radar-panel';

type Props = Record<string, unknown> & {
  place?: string; name?: string; title?: string; magnitude?: number; depth_km?: number; headline?: string; alert_level?: string;
  severity?: string; displacement_label?: string;
};

function kindOf(f: UnifiedFeature, p: Props): string {
  if (f.source === 'seismic') return 'SEISMIC EVENT';
  if (f.source === 'volcanism') return 'VOLCANIC EVENT';
  if (f.source === 'cryosphere') return 'ICE UPDATE';
  return /CYCLONE|STORM|HURRICANE|TYPHOON/i.test(String(p.severity ?? p.title ?? '')) ? 'TROPICAL CYCLONE' : 'TSUNAMI ALERT';
}

function sizeTag(f: UnifiedFeature, p: Props): string | null {
  if (f.source === 'seismic' && p.magnitude != null) return `M ${p.magnitude.toFixed(1)}${p.depth_km != null ? ` · ${p.depth_km.toFixed(0)} km deep` : ''}`;
  const t = p.headline ?? p.alert_level ?? (f.source === 'tsunami' ? p.severity : undefined);
  return t ? String(t) : null;
}

export function EventReticle({ feature }: { feature: UnifiedFeature }) {
  const p = feature.properties as unknown as Props;
  const point = featurePoint(feature);
  const index = useMeasuredIndex();
  const hit = point ? matchFields(index, point)[0] ?? null : null;
  const s = useMeasuredSummary(hit?.id ?? null);

  const modelled = p.displacement_label
    ?? (feature.source === 'seismic' && p.magnitude != null ? estimateDisplacement({ type: 'tectonic', magnitude: p.magnitude, depth: p.depth_km ?? null, displacement_cm: null }).label : null);
  const measured = hit && s ? fmtRangeCm(s.lo, s.hi) : null;
  const chip = measured ? { label: 'NISAR measured', value: measured, green: true } : modelled && modelled !== 'N/A' ? { label: 'Modelled est.', value: String(modelled), green: false } : null;

  const name = p.place ?? p.name ?? p.title ?? 'Event';
  const tag = sizeTag(feature, p);

  return (
    <motion.div
      key={feature.id}
      className="relative w-0 h-0 pointer-events-none"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.5, duration: 0.4, ease: 'easeOut' }}
    >
      {/* rotating ring with four ticks, and a still inner ring */}
      <div className="absolute rounded-full border border-red-500/25 animate-spin" style={{ width: 100, height: 100, left: -50, top: -50, animationDuration: '10s' }}>
        <div className="w-[3px] h-4 bg-red-500/70 absolute top-0 left-1/2 -translate-x-1/2" />
        <div className="w-[3px] h-4 bg-red-500/70 absolute bottom-0 left-1/2 -translate-x-1/2" />
        <div className="w-4 h-[3px] bg-red-500/70 absolute left-0 top-1/2 -translate-y-1/2" />
        <div className="w-4 h-[3px] bg-red-500/70 absolute right-0 top-1/2 -translate-y-1/2" />
      </div>
      <div className="absolute rounded-full border border-red-500/35" style={{ width: 64, height: 64, left: -32, top: -32 }} />

      {/* the event itself */}
      <div className="absolute flex items-center justify-center" style={{ width: 28, height: 28, left: -14, top: -14, border: '2px solid #ef4444', background: 'rgba(9,9,11,.92)', boxShadow: '0 0 14px rgba(239,68,68,.55)' }}>
        <span className="text-[13px] leading-none text-red-500">{feature.source === 'seismic' ? '▲' : feature.source.charAt(0).toUpperCase()}</span>
      </div>

      {/* chip and banner above */}
      <div className="absolute flex flex-col items-center gap-1.5 whitespace-nowrap" style={{ left: 0, bottom: 62, transform: 'translateX(-50%)' }}>
        {chip && (
          <div className="flex items-center gap-1.5" style={{ background: 'rgba(9,9,11,.9)', border: `1px solid ${chip.green ? 'rgba(52,211,153,.5)' : 'rgba(239,68,68,.45)'}`, padding: '3px 8px', backdropFilter: 'blur(12px)', boxShadow: '0 0 12px rgba(239,68,68,.2)' }}>
            <span className="font-mono text-[9px] text-white/50">{chip.label}</span>
            <span className="font-mono text-[10px] font-bold" style={{ color: chip.green ? '#34d399' : '#fff' }}>{chip.value}</span>
          </div>
        )}
        <div className="flex items-center gap-2" style={{ maxWidth: 320, background: 'rgba(127,29,29,.42)', border: '1px solid rgba(239,68,68,.7)', padding: '6px 12px', backdropFilter: 'blur(12px)', boxShadow: '0 0 18px rgba(239,68,68,.3)' }}>
          <span className="font-mono text-[11px] font-bold tracking-wider text-red-500">⚠ {kindOf(feature, p)}</span>
          <span className="font-mono text-[11px] font-bold tracking-wider text-white uppercase overflow-hidden text-ellipsis">{name}</span>
        </div>
      </div>

      {/* size tag below */}
      {tag && (
        <div className="absolute whitespace-nowrap" style={{ left: 0, top: 62, transform: 'translateX(-50%)', background: 'rgba(9,9,11,.85)', border: '1px solid rgba(239,68,68,.28)', padding: '2px 7px' }}>
          <span className="font-mono text-[9px]" style={{ color: '#fb923c' }}>▲</span>
          <span className="font-mono text-[9px] text-white/70 ml-1">{tag}</span>
        </div>
      )}
    </motion.div>
  );
}
