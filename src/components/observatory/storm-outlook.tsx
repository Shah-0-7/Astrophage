'use client';

import type { GlobalEvent } from '@/lib/globalEvents';
import { useStormForecast } from '@/lib/useStormForecast';
import { compass } from '@/lib/stormForecast';
import { nearestPlace } from '@/lib/placeSearch';

/** Plain-language outlook for a storm, from the projection in `stormForecast`. Always marked as an estimate. */
export function StormOutlook({ event, className, card }: { event: GlobalEvent; className?: string; /** Report-page card markup instead of a ledger stat tile. */ card?: boolean }) {
  const f = useStormForecast(event);
  if (event.type !== 'storm') return null;

  let headline: string, detail: string;
  if (!f) {
    headline = 'No projection';
    detail = 'The source gives too little timed track to estimate where this storm is heading.';
  } else {
    const m = f.motion;
    const heading = `Moving ${compass(m.bearing)} at ${Math.round(m.speedKmh)} km/h`;
    if (f.onLand) { headline = 'Over land'; detail = `${heading}. The centre is already over land.`; }
    else if (f.landfall) {
      const p = nearestPlace(f.landfall.lat, f.landfall.lon);
      const where = p ? `near ${p.name}` : `at ${Math.abs(f.landfall.lat).toFixed(1)}°${f.landfall.lat >= 0 ? 'N' : 'S'} ${Math.abs(f.landfall.lon).toFixed(1)}°${f.landfall.lon >= 0 ? 'E' : 'W'}`;
      headline = `Landfall ${where} in ~${f.landfall.hours} h`;
      detail = `${heading}. If it holds this course the centre reaches land ${where} in roughly ${f.landfall.hours} hours.`;
    } else if (f.coneLandHours != null) {
      headline = 'Centre stays at sea · cone reaches land';
      detail = `${heading}. The projected centre stays over water for ${f.horizonHours} h, but the edge of the uncertainty cone reaches land in about ${f.coneLandHours} h.`;
    } else { headline = `No landfall in ${f.horizonHours} h`; detail = `${heading}. The projected path stays over open water for ${f.horizonHours} hours.`; }
  }
  const note = `${detail} Extrapolated from the storm's recent track, not an official forecast: check NHC or JTWC for warnings.`;
  if (card) {
    return (
      <section className={className}>
        <h3>PROJECTED PATH (EST.)</h3>
        <div className="rp-big" style={{ fontSize: 'clamp(18px, 2.2vw, 26px)' }}>{headline}</div>
        <small>{note}</small>
      </section>
    );
  }
  return (
    <div className={className}>
      <dt>Projected path · estimate</dt>
      <dd>{headline}</dd>
      <small>{note}</small>
    </div>
  );
}
