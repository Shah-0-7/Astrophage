'use client';

/**
 * /events/[id] – Event report.
 *
 * Resolves the event (stashed by the directory, or looked up from the feeds), asks /api/event-report to pull the
 * USGS / NASA / Wikipedia detail, and renders a short written summary with the supporting facts. If the live
 * detail is unavailable the page still produces a summary from the event record alone.
 */

import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { OutlineWordmark } from '@/components/ui/outline-wordmark';
import { RegionMap } from '@/components/observatory/region-map';
import { fetchAllGlobalEvents, type GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG, CAUSE_LABELS } from '@/lib/eventDirectoryTypes';
import { buildReport, utcStamp, type EventReport } from '@/lib/eventReport';
import './report.css';

type Phase = 'loading' | 'ready' | 'partial' | 'missing';

function readStash(id: string): GlobalEvent | null {
  try { const raw = sessionStorage.getItem(`ob_event_${id}`); return raw ? (JSON.parse(raw) as GlobalEvent) : null; } catch { return null; }
}

function reportUrl(id: string, e: GlobalEvent | null) {
  const q = new URLSearchParams({ id });
  if (e) {
    q.set('title', e.title); q.set('lat', String(e.lat)); q.set('lon', String(e.lon)); q.set('time', String(e.time));
    q.set('type', e.type); q.set('cause', e.cause); q.set('src', e.source); q.set('url', e.source_url);
    if (e.magnitude != null) q.set('mag', String(e.magnitude));
    if (e.depth != null) q.set('depth', String(e.depth));
  }
  return `/api/event-report?${q}`;
}

function headlineNumber(e: GlobalEvent): { prefix: string; value: string } | null {
  if (e.magnitude == null) return null;
  return e.source === 'Smithsonian GVP' ? { prefix: 'VEI', value: String(Math.round(e.magnitude)) } : { prefix: 'M', value: e.magnitude.toFixed(1) };
}

function EventReportInner({ id }: { id: string }) {
  const [report, setReport] = useState<EventReport | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    (async () => {
      let base: GlobalEvent | null = readStash(id);
      if (!base && !id.startsWith('usgs_')) {
        // Opened from a shared link: find the record in the feeds.
        try { base = (await fetchAllGlobalEvents(() => {})).find(e => e.id === id) ?? null; } catch { /* offline */ }
      }
      try {
        const res = await fetch(reportUrl(id, base));
        if (res.ok) { const r = (await res.json()) as EventReport; if (alive) { setReport(r); setPhase('ready'); } return; }
      } catch { /* fall through to the local summary */ }
      if (!alive) return;
      if (base) {
        setReport(buildReport({ event: base, sources: [{ name: base.source, url: base.source_url, ok: true }] }));
        setPhase('partial');
      } else setPhase('missing');
    })();
    return () => { alive = false; };
  }, [id, tick]);

  const share = useCallback(async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  }, []);

  const e = report?.event ?? null;
  const cfg = e ? EVENT_TYPE_CONFIG[e.type] : null;
  const num = useMemo(() => (e ? headlineNumber(e) : null), [e]);
  const stamp = e ? utcStamp(e.time) : null;
  const disp = report?.displacement ?? null;

  return (
    <main className="rp" style={cfg ? ({ '--c': cfg.color } as React.CSSProperties) : undefined}>
      <header className="rp-bar">
        <Link href="/events" className="rp-back" aria-label="Back to the event ledger">← EVENTS</Link>
        <Link href="/" className="rp-brand" aria-label="Astrophage home">
          <OutlineWordmark text="ASTROPHAGE" style={{ fontFamily: 'var(--font-display), "Arial Black", system-ui, sans-serif', fontWeight: 700, fontSize: 16, letterSpacing: '.14em' }} />
        </Link>
        <div className="rp-bar-r">
          <button type="button" onClick={share}>{copied ? '✓ COPIED' : 'COPY LINK'}</button>
          {e?.source_url && <a href={e.source_url} target="_blank" rel="noreferrer">SOURCE ↗</a>}
        </div>
      </header>

      {phase === 'loading' && (
        <section className="rp-load" aria-live="polite">
          <div className="rp-spin" />
          <p>PULLING DETAIL FROM THE SOURCE APIS…</p>
          <div className="rp-skel"><i /><i /><i /></div>
        </section>
      )}

      {phase === 'missing' && (
        <section className="rp-load">
          <p>THIS EVENT COULD NOT BE LOADED.</p>
          <small>Open it from the event ledger, or check your connection.</small>
          <div className="rp-actions"><button type="button" onClick={() => setTick(t => t + 1)}>TRY AGAIN</button><Link href="/events">BACK TO EVENTS</Link></div>
        </section>
      )}

      {report && e && cfg && stamp && disp && (
        <>
          <section className="rp-hero">
            <div className="rp-kicker"><i />EVENT REPORT · {cfg.label.toUpperCase()} · {CAUSE_LABELS[e.cause].toUpperCase()}</div>
            <h1 className="rp-num">{num ? <><small>{num.prefix}</small>{num.value}</> : <span>{cfg.icon}</span>}</h1>
            <h2 className="rp-title">{e.title}</h2>
            <p className="rp-when">{stamp.iso}</p>
            {phase === 'partial' && <p className="rp-note">Live detail from the source APIs could not be reached, so this summary uses the event record only.</p>}
          </section>

          <div className="rp-grid">
            <div className="rp-main">
              <section className="rp-card rp-summary">
                <h3>SUMMARY</h3>
                <p>{report.summary}</p>
              </section>

              <section className="rp-card">
                <h3>KEY FACTS</h3>
                <dl className="rp-facts">
                  {report.facts.map(f => (
                    <div key={f.label} data-tone={f.tone}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                      {f.note && <small>{f.note}</small>}
                    </div>
                  ))}
                </dl>
              </section>

              {report.sections.map(s => (
                <section key={s.heading} className="rp-card">
                  <h3>{s.heading.toUpperCase()}</h3>
                  {s.lines.map((l, i) => <p key={i} className="rp-line">{l}</p>)}
                </section>
              ))}
            </div>

            <aside className="rp-side">
              <div className="rp-map"><RegionMap event={e} className="rp-canvas" /></div>
              <section className="rp-card rp-disp">
                <h3>SURFACE DISPLACEMENT</h3>
                <div className="rp-big">{disp.label}</div>
                <p>{disp.note}</p>
                <small>Modelled from magnitude and depth, not measured. Measured values will come from NISAR InSAR and GNSS once that pipeline is connected.</small>
              </section>
              {disp.rupture && (
                <section className="rp-card">
                  <h3>AREA COVERED (EST.)</h3>
                  <div className="rp-big">{disp.rupture.areaKm2 < 10 ? disp.rupture.areaKm2.toFixed(1) : Math.round(disp.rupture.areaKm2).toLocaleString()} KM²</div>
                  <p>Fault patch about {Math.max(disp.rupture.lengthKm, disp.rupture.widthKm).toFixed(0)} × {Math.min(disp.rupture.lengthKm, disp.rupture.widthKm).toFixed(0)} km.</p>
                </section>
              )}
            </aside>
          </div>

          <footer className="rp-foot">
            <div className="rp-sources">
              <span>SOURCES</span>
              {report.sources.map(s => (
                <a key={s.name} href={s.url} target="_blank" rel="noreferrer" title={s.note}><i data-ok={s.ok} />{s.name}</a>
              ))}
            </div>
            <p>Summary generated {new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC from the sources above. Sentences marked as estimates use published scaling relations (Wells &amp; Coppersmith 1994; Hanks &amp; Kanamori 1979) and are not measurements.</p>
          </footer>
        </>
      )}
    </main>
  );
}

export default function EventReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <EventReportInner id={decodeURIComponent(id)} />
    </Suspense>
  );
}
