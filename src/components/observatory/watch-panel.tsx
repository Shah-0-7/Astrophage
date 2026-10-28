'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG, REGIONS } from '@/lib/eventDirectoryTypes';
import { describeRule, type WatchRule } from '@/lib/watchlist';
import type { Watchlist } from '@/lib/useWatchlist';
import type { Place } from '@/lib/placeSearch';
import { PlaceSuggest } from './place-suggest';
import { stormOf } from '@/lib/stormScale';
import './watch-panel.css';

const TYPES = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
const regionLabel = (id: string) => REGIONS.find(r => r.id === id)?.label ?? id;
const typeLabel = (t: EventType) => EVENT_TYPE_CONFIG[t].label;

function ago(ms: number) {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return m < 60 ? `${m}M AGO` : m < 1440 ? `${Math.floor(m / 60)}H AGO` : `${Math.floor(m / 1440)}D AGO`;
}
function headline(e: GlobalEvent) {
  if (e.type === 'storm') { const c = stormOf(e); return c ? (/^\d$/.test(c.code) ? `CAT ${c.code}` : `${Math.round(e.wind_kts ?? 0)} KT`) : 'STORM'; }
  if (e.magnitude == null) return '—';
  return e.source === 'Smithsonian GVP' ? `VEI ${Math.round(e.magnitude)}` : `M ${e.magnitude.toFixed(1)}`;
}

/** Bell button for the top bar. */
export function WatchBell({ watch }: { watch: Watchlist }) {
  const n = watch.unread.length;
  return (
    <button type="button" className="wp-bell" aria-label={n ? `Watchlist, ${n} new alerts` : 'Watchlist'} aria-expanded={watch.open} onClick={() => watch.setOpen(!watch.open)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 11.5h9l-1.2-1.7V7a3.3 3.3 0 0 0-6.6 0v2.8L3.5 11.5zM6.6 13.5a1.5 1.5 0 0 0 2.8 0" /></svg>
      {n > 0 && <b>{n > 9 ? '9+' : n}</b>}
    </button>
  );
}

function RuleForm({ onAdd, onCancel }: { onAdd: (r: Partial<WatchRule>) => void; onCancel: () => void }) {
  const [types, setTypes] = useState<EventType[]>([]);
  const [region, setRegion] = useState('');
  const [minMag, setMinMag] = useState(0);
  const [minCat, setMinCat] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const [radius, setRadius] = useState(500);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const storms = types.length === 0 || types.includes('storm');
  const quakes = types.length === 0 || types.some(t => t !== 'storm');
  const toggle = (t: EventType) => setTypes(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));

  return (
    <form className="wp-form" onSubmit={e => {
      e.preventDefault();
      onAdd({ types, region, minMagnitude: quakes ? minMag : 0, minCategory: storms ? minCat : 0, at: place ? { lat: place.lat, lon: place.lon, name: place.name, radiusKm: radius } : null });
    }}>
      <div className="wp-label">EVENT TYPE <small>none selected = any</small></div>
      <div className="wp-chips" role="group" aria-label="Event types">
        {TYPES.map(t => (
          <button key={t} type="button" data-on={types.includes(t)} aria-pressed={types.includes(t)} style={{ '--c': EVENT_TYPE_CONFIG[t].color } as React.CSSProperties} onClick={() => toggle(t)}><i />{EVENT_TYPE_CONFIG[t].label}</button>
        ))}
      </div>
      {quakes && (
        <label className="wp-field">Minimum magnitude · {minMag > 0 ? minMag.toFixed(1) : 'any'}
          <input type="range" min={0} max={8} step={0.5} value={minMag} onChange={e => setMinMag(Number(e.target.value))} />
        </label>
      )}
      {storms && (
        <label className="wp-field">Storm strength
          <select value={minCat} onChange={e => setMinCat(Number(e.target.value))}>
            <option value={0}>Any tropical storm</option>
            {[1, 2, 3, 4, 5].map(c => <option key={c} value={c}>Category {c} or stronger{c === 4 ? ' (above Cat 3)' : ''}</option>)}
          </select>
        </label>
      )}
      <label className="wp-field">Region
        <select value={region} onChange={e => setRegion(e.target.value)} disabled={!!place}>
          <option value="">Anywhere</option>
          {REGIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <div className="wp-field wp-place">Or near a place
        {place ? (
          <div className="wp-picked">
            <b>{place.name.toUpperCase()}</b>
            <select value={radius} aria-label="Radius" onChange={e => setRadius(Number(e.target.value))}>{[100, 250, 500, 1000, 2000].map(r => <option key={r} value={r}>{r} KM</option>)}</select>
            <button type="button" aria-label="Remove place" onClick={() => setPlace(null)}>×</button>
          </div>
        ) : (
          <div className="wp-search">
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Tokyo, Reykjavik…" aria-label="Place to watch" />
            <PlaceSuggest query={q} inputRef={input} onPick={p => { setPlace(p); setRegion(''); setQ(''); }} />
          </div>
        )}
      </div>
      <div className="wp-actions">
        <button type="submit" className="wp-primary">START WATCHING</button>
        <button type="button" onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
}

/** Slide-over panel: new alerts, the rules that produce them, and how notifications are delivered. */
export function WatchPanel({ watch }: { watch: Watchlist }) {
  const [adding, setAdding] = useState(false);
  if (!watch.open) return null;
  const { rules, alerts, unread } = watch;
  const unreadIds = new Set(unread.map(a => a.event.id));

  return (
    <aside className="wp" role="dialog" aria-label="Watchlist and alerts">
      <header>
        <div><small>ASTROPHAGE / WATCH</small><h2>ALERTS</h2></div>
        <button type="button" className="wp-x" aria-label="Close" onClick={() => watch.setOpen(false)}>×</button>
      </header>

      <div className="wp-body">
        {rules.length === 0 && !adding && (
          <p className="wp-empty">Follow a region, an event type or a place. Matching events from the last 48 hours show up here as the feeds update.</p>
        )}

        {rules.length > 0 && (
          <section>
            <div className="wp-head"><h3>{alerts.length ? `MATCHES · ${alerts.length}` : 'NO MATCHES RIGHT NOW'}</h3>{unread.length > 0 && <button type="button" onClick={() => watch.markRead()}>MARK ALL READ</button>}</div>
            <ul className="wp-alerts">
              {alerts.slice(0, 30).map(({ event: e, rule }) => (
                <li key={e.id} data-new={unreadIds.has(e.id)}>
                  <Link href={`/events/${encodeURIComponent(e.id)}`} onClick={() => { try { sessionStorage.setItem(`ob_event_${e.id}`, JSON.stringify(e)); } catch { /* ignore */ } watch.markRead([e.id]); }}>
                    <b style={{ color: EVENT_TYPE_CONFIG[e.type].color }}>{headline(e)}</b>
                    <span>{e.title}<small>{rule.name || describeRule(rule, regionLabel, typeLabel)}</small></span>
                    <em>{ago(e.time)}</em>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="wp-head"><h3>RULES · {rules.length}</h3>{!adding && <button type="button" onClick={() => setAdding(true)}>+ NEW RULE</button>}</div>
          {adding && <RuleForm onCancel={() => setAdding(false)} onAdd={r => { watch.addRule(r); setAdding(false); }} />}
          <ul className="wp-rules">
            {rules.map(r => (
              <li key={r.id}><span>{r.name || describeRule(r, regionLabel, typeLabel)}</span><button type="button" aria-label={`Delete rule: ${describeRule(r, regionLabel, typeLabel)}`} onClick={() => watch.removeRule(r.id)}>REMOVE</button></li>
            ))}
          </ul>
        </section>

        <section className="wp-notify">
          <h3>NOTIFICATIONS</h3>
          {watch.notify === 'granted' && <p>Browser notifications are on. You are notified when a new match appears while Astrophage is open in a tab.</p>}
          {watch.notify === 'default' && <p>Get a desktop notification when a new match appears. <button type="button" className="wp-primary" onClick={() => void watch.enableNotifications()}>TURN ON</button></p>}
          {watch.notify === 'denied' && <p>Notifications are blocked for this site. Allow them in your browser&apos;s site settings to turn them on.</p>}
          {watch.notify === 'unsupported' && <p>This browser or context does not support notifications. Alerts still appear in this panel.</p>}
          <p className="wp-fine">Rules are stored in this browser only, and feeds are checked every 5 minutes while the app is open. Email or phone push when the app is closed needs an account and a server, which this version does not have.</p>
        </section>
      </div>
    </aside>
  );
}
