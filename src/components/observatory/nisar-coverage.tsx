'use client';

import { PRODUCTS } from '@/lib/nisar/catalog';
import type { InterferogramBrief } from '@/lib/nisar/api';
import { NISAR_LINKS } from '@/lib/nisar/catalog';
import type { NisarProduct } from '@/lib/nisar/types';
import { useNisarCoverage } from '@/lib/useNisarCoverage';
import './nisar-coverage.css';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

function Pair({ g }: { g: InterferogramBrief }) {
  const pair = g.pairReference != null && g.pairSecondary != null ? `${day(g.pairReference)} → ${day(g.pairSecondary)}` : `${day(g.start)} → ${day(g.end)}`;
  return (
    <li>
      <div className="nc-row">
        <b>{g.product}</b>
        <span className="nc-fit" data-fit={g.fit}>{g.fit === 'spans-event' ? 'SPANS THE EVENT' : 'AFTER THE EVENT'}</span>
        <span className="nc-dates">{pair}{g.spanDays >= 1 ? ` · ${Math.round(g.spanDays)} d` : ''}</span>
      </div>
      <div className="nc-sub">
        {g.maturity.toLowerCase()}{g.track != null ? ` · track ${g.track}` : ''}{g.frame != null ? ` · frame ${g.frame}` : ''}{g.direction ? ` · ${g.direction === 'A' ? 'ascending' : 'descending'}` : ''}{g.sizeMb ? ` · ${g.sizeMb >= 1024 ? `${(g.sizeMb / 1024).toFixed(1)} GB` : `${g.sizeMb} MB`}` : ''}
        {' · '}<a href={g.metadataUrl} target="_blank" rel="noreferrer">metadata ↗</a>
        {g.dataUrl && <>{' · '}<a href={g.dataUrl} target="_blank" rel="noreferrer">file ↗</a></>}
      </div>
    </li>
  );
}

/**
 * Real NISAR observations over an event, from NASA's catalogue (CMR). Catalogue records only: nothing is downloaded or
 * processed here, so displacement figures elsewhere on the page stay labelled "modelled".
 */
export function NisarCoverage({ event, compact = false, className = '' }: { event: { lat: number; lon: number; time: number }; compact?: boolean; className?: string }) {
  const st = useNisarCoverage(event);
  const cls = `nc ${compact ? 'nc-compact' : ''} ${className}`;

  let body: React.ReactNode;
  if (st.phase === 'loading') body = <p className="nc-muted" aria-live="polite">Checking NASA&apos;s NISAR catalogue…</p>;
  else if (st.phase === 'failed') body = <p className="nc-muted">The NISAR catalogue could not be reached.</p>;
  else {
    const d = st.data;
    if (d.status === 'unavailable') body = <p className="nc-muted">NASA&apos;s catalogue (CMR) is not responding right now, so NISAR coverage is unknown. Try again in a few minutes.</p>;
    else if (d.status === 'future') body = <p className="nc-muted">This event has not happened yet.</p>;
    else if (d.status === 'pre-mission') body = <p className="nc-muted">This event is before NISAR&apos;s public archive begins ({day(d.archiveStart)}).</p>;
    else {
      const c = d.coverage;
      const spans = d.interferograms.filter(i => i.fit === 'spans-event');
      body = (
        <>
          {c.total === 0 ? (
            <p>NASA&apos;s catalogue lists <b>no NISAR scenes</b> covering this location yet.</p>
          ) : (
            <p>NISAR has imaged this location <b>{plural(c.total, 'time')}</b>{c.firstSeen && c.lastSeen ? <> between {day(c.firstSeen)} and {day(c.lastSeen)}</> : null}{c.afterEvent > 0 ? <>; <b>{c.afterEvent}</b> since the event</> : null}.{d.truncated ? ' (Count is capped.)' : ''}</p>
          )}
          {c.total > 0 && !compact && (
            <div className="nc-chips">
              {(Object.keys(c.byProduct) as NisarProduct[]).map(p => <span key={p} title={PRODUCTS[p].name}>{p} {c.byProduct[p]}</span>)}
            </div>
          )}
          {c.total > 0 && (
            <>
              <h4>INSAR PRODUCTS (INTERFEROGRAMS)</h4>
              {d.interferograms.length > 0 ? (
                <>
                  <p className="nc-lead">{spans.length > 0 ? <><b>{plural(spans.length, 'interferogram')}</b> pair a date before and after the event, so {spans.length === 1 ? 'it should' : 'they should'} contain its ground motion.</> : 'No published interferogram spans the event date yet; the pairs below start after it.'}</p>
                  <ul className="nc-list">{d.interferograms.slice(0, compact ? 2 : 5).map(g => <Pair key={g.id} g={g} />)}</ul>
                  {d.interferogramTotal > (compact ? 2 : 5) && <p className="nc-muted">{d.interferogramTotal - (compact ? 2 : 5)} more on ASF.</p>}
                </>
              ) : <p className="nc-muted">No interferogram product has been published for this location after the event date yet. NISAR products appear 36–72 hours after acquisition, and interferograms need two passes.</p>}
            </>
          )}
          {d.partial && <p className="nc-muted">Part of the catalogue did not respond, so these results may be incomplete.</p>}
        </>
      );
    }
    if (d.opera.fit !== 'outside-region' && d.status !== 'unavailable') {
      body = (
        <>
          {body}
          <p className="nc-opera">
            <b>OPERA DISP-S1</b> (Sentinel-1 displacement time series) covers this region
            {d.opera.fit === 'covered-period' ? ': the event falls inside the published 2016–2024 period.' : ', but this event is outside the published 2016–2024 period.'}{' '}
            <a href={d.opera.portal} target="_blank" rel="noreferrer">ASF displacement portal ↗</a>
          </p>
        </>
      );
    }
  }

  return (
    <section className={cls} aria-label="NISAR observations">
      <h3>NISAR OBSERVATIONS <span className="nc-tag">NASA CMR · REAL RECORDS</span></h3>
      {body}
      <small className="nc-fine">
        Catalogue records, not measurements: this app does not download or process the files, and the displacement estimate above is still modelled.
        Files need a free NASA Earthdata login. <a href={NISAR_LINKS.asfSearch} target="_blank" rel="noreferrer">Search NISAR on ASF ↗</a>
      </small>
    </section>
  );
}
