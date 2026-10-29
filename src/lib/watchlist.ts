import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { classifyStorm } from '@/lib/stormScale';
import { getRegion, REGIONS } from '@/lib/eventDirectoryTypes';

/**
 * A watch rule: "tell me when something like this happens". Every field narrows the match; empty = any.
 * Rules and what has been announced are kept in this browser only (no account, no server).
 */
export interface WatchRule {
  id: string;
  name: string;
  types: EventType[];        // [] = any type
  region: string;            // '' = anywhere (a region id from eventDirectoryTypes)
  minMagnitude: number;      // applies to events with a magnitude (not storms); 0 = no minimum
  minCategory: number;       // storms only: 0 = any storm, 1–5 = at least that Saffir–Simpson category
  at: { lat: number; lon: number; name: string; radiusKm: number } | null;
  createdAt: number;
}

export interface WatchAlert { rule: WatchRule; event: GlobalEvent }

/** How far back a match still counts as an alert. */
export const ALERT_WINDOW_MS = 48 * 3_600_000;

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Saffir–Simpson category of a storm event: 0 for depressions/storms (or unknown wind), 1–5 for hurricanes/typhoons. */
export function stormCategory(e: GlobalEvent): number {
  const c = classifyStorm(e.wind_kts, e.lat, e.lon);
  return c && /^\d$/.test(c.code) ? Number(c.code) : 0;
}

export function matchesRule(rule: WatchRule, e: GlobalEvent): boolean {
  if (rule.types.length && !rule.types.includes(e.type)) return false;
  if (rule.region && getRegion(e.lat, e.lon) !== rule.region) return false;
  if (rule.at && km(rule.at.lat, rule.at.lon, e.lat, e.lon) > rule.at.radiusKm) return false;
  if (e.type === 'storm') {
    if (rule.minCategory > 0 && stormCategory(e) < rule.minCategory) return false;
  } else if (rule.minMagnitude > 0) {
    // An unmeasured event can't be shown to clear a magnitude bar.
    if (e.magnitude == null || e.magnitude < rule.minMagnitude) return false;
  }
  return true;
}

/** Recent events that match any rule, newest first, each paired with the first rule it matched. */
export function findAlerts(rules: WatchRule[], events: GlobalEvent[], now: number): WatchAlert[] {
  if (!rules.length) return [];
  const out: WatchAlert[] = [];
  for (const e of events) {
    if (now - e.time > ALERT_WINDOW_MS || e.time > now + 3_600_000) continue;
    const rule = rules.find(r => matchesRule(r, e));
    if (rule) out.push({ rule, event: e });
  }
  return out.sort((a, b) => b.event.time - a.event.time);
}

/** One-line description of a rule, for lists. */
export function describeRule(r: WatchRule, regionLabel: (id: string) => string, typeLabel: (t: EventType) => string): string {
  const parts: string[] = [];
  parts.push(r.types.length ? r.types.map(typeLabel).join(' / ') : 'Any event');
  const storms = !r.types.length || r.types.includes('storm');
  const quakes = !r.types.length || r.types.some(t => t !== 'storm');
  if (r.minMagnitude > 0 && quakes) parts.push(`M ≥ ${r.minMagnitude.toFixed(1)}`);
  if (r.minCategory > 0 && storms) parts.push(`Cat ≥ ${r.minCategory}`);
  if (r.region) parts.push(regionLabel(r.region));
  if (r.at) parts.push(`within ${r.at.radiusKm} km of ${r.at.name}`);
  return parts.join(' · ');
}

/* ── persistence (localStorage, all guarded) ─────────────────── */
const RULES_KEY = 'ob_watch_rules_v1';
const SEEN_KEY = 'ob_watch_seen_v1';
const NOTIFIED_KEY = 'ob_watch_notified_v1';
const MAX_SEEN = 600;

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode / quota */ } }

const isRule = (r: unknown): r is WatchRule =>
  !!r && typeof r === 'object' && typeof (r as WatchRule).id === 'string' && Array.isArray((r as WatchRule).types) &&
  typeof (r as WatchRule).minMagnitude === 'number' && typeof (r as WatchRule).minCategory === 'number';

export const loadRules = (): WatchRule[] => read<unknown[]>(RULES_KEY, []).filter(isRule);
export const saveRules = (r: WatchRule[]) => write(RULES_KEY, r);
/** Ids of events the person has already been told about or has dismissed. */
export const loadSeen = (): string[] => read<string[]>(SEEN_KEY, []).filter(x => typeof x === 'string');
export const saveSeen = (ids: string[]) => write(SEEN_KEY, ids.slice(-MAX_SEEN));

export function newRule(partial: Partial<WatchRule> & { name?: string }): WatchRule {
  return {
    id: `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: partial.name ?? '',
    types: partial.types ?? [], region: partial.region ?? '', minMagnitude: partial.minMagnitude ?? 0,
    minCategory: partial.minCategory ?? 0, at: partial.at ?? null, createdAt: Date.now(),
  };
}

/** Ids already pushed as browser notifications, so a reload never repeats one. */
export const loadNotified = (): string[] => read<string[]>(NOTIFIED_KEY, []).filter(x => typeof x === 'string');
export const saveNotified = (ids: string[]) => write(NOTIFIED_KEY, ids.slice(-MAX_SEEN));

/** Should this match raise a browser notification? Only for events from around or after the rule was made. */
export const shouldNotify = (rule: WatchRule, e: GlobalEvent) => e.time >= rule.createdAt - 2 * 3_600_000;

/** Short text for a notification about one alert. */
export function alertText(e: GlobalEvent): { title: string; body: string } {
  if (e.type === 'storm') {
    const c = classifyStorm(e.wind_kts, e.lat, e.lon);
    return { title: `${c ? c.full : 'Tropical storm'}`, body: e.title };
  }
  const label = e.source === 'Smithsonian GVP' ? 'VEI' : 'M';
  return { title: e.magnitude != null ? `${label} ${e.source === 'Smithsonian GVP' ? Math.round(e.magnitude) : e.magnitude.toFixed(1)}` : e.type, body: e.title };
}

export const MAX_RULES = 20;
const EVENT_TYPES: EventType[] = ['tectonic', 'volcanic', 'landslide', 'cryosphere', 'subsidence', 'mining', 'induced_seismicity', 'tsunami', 'storm'];

/**
 * Clean up rules from an untrusted source (the request body, or stored JSON). Unknown types and regions are dropped,
 * numbers clamped, strings trimmed; entries that are not rules at all are skipped. At most MAX_RULES are kept.
 */
export function sanitizeRules(input: unknown): WatchRule[] {
  if (!Array.isArray(input)) return [];
  const out: WatchRule[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
    let at: WatchRule['at'] = null;
    const a = r.at as Record<string, unknown> | null | undefined;
    if (a && typeof a === 'object' && typeof a.lat === 'number' && typeof a.lon === 'number' && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180) {
      at = { lat: a.lat, lon: a.lon, name: String(a.name ?? '').slice(0, 60), radiusKm: Math.round(num(a.radiusKm, 10, 5000)) };
    }
    let id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : '';
    if (!id || seen.has(id)) id = newRule({}).id;
    seen.add(id);
    out.push({
      id,
      name: String(r.name ?? '').slice(0, 60),
      types: Array.isArray(r.types) ? Array.from(new Set(r.types.filter((t): t is EventType => EVENT_TYPES.includes(t as EventType)))) : [],
      region: typeof r.region === 'string' && REGIONS.some(g => g.id === r.region) ? r.region : '',
      minMagnitude: Math.round(num(r.minMagnitude, 0, 10) * 10) / 10,
      minCategory: Math.round(num(r.minCategory, 0, 5)),
      at,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

/** What a rule matches, ignoring its id and name: two rules with the same signature are duplicates. */
export function ruleSignature(r: WatchRule): string {
  return JSON.stringify([[...r.types].sort(), r.region, r.minMagnitude, r.minCategory, r.at ? [r.at.lat, r.at.lon, r.at.radiusKm] : null]);
}

/**
 * Combine the rules saved on an account with the ones already in this browser (the person built a list, then signed in).
 * Account rules come first; a local rule is added unless an equivalent one is already there. Capped at MAX_RULES.
 */
export function mergeRules(account: WatchRule[], local: WatchRule[]): WatchRule[] {
  const out = [...account];
  const sigs = new Set(out.map(ruleSignature)), ids = new Set(out.map(r => r.id));
  for (const r of local) {
    if (out.length >= MAX_RULES) break;
    if (sigs.has(ruleSignature(r)) || ids.has(r.id)) continue;
    sigs.add(ruleSignature(r)); ids.add(r.id); out.push(r);
  }
  return out;
}
