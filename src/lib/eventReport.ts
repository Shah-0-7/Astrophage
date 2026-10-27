/**
 * eventReport – turns an event plus whatever the upstream APIs told us into a short, factual report.
 *
 * The text is generated from fixed templates over real fields (no language model): every sentence states either a
 * value that came from a named source, or a clearly marked estimate. Anything an API did not provide is stated as
 * "not reported" rather than guessed.
 */
import type { GlobalEvent } from './globalEvents';
import { stormOf, fmtWind } from './stormScale';
import { depthClass, estimateDisplacement, fmtDisp, magClass, MMI_WORDS, roman, ruptureFromMagnitude, type DisplacementEstimate } from './eventPhysics';

export interface NearbyPlace { name: string; distanceKm: number; direction: string; population: number | null }

/** Normalised facts pulled from USGS (event detail, PAGER, ShakeMap, DYFI, ground-failure, nearby cities). */
export interface QuakeIntel {
  magType?: string | null;
  status?: string | null;
  felt?: number | null;
  cdi?: number | null;
  mmi?: number | null;
  alert?: string | null;              // PAGER overall alert colour
  fatalityAlert?: string | null;
  economicAlert?: string | null;
  pagerComments: string[];
  exposedMmi6Plus?: number | null;    // people exposed to MMI VI or stronger
  shakemapAreaKm2?: number | null;
  maxPga?: number | null;             // %g
  tsunami?: boolean;
  sig?: number | null;
  landslideAlert?: string | null;
  liquefactionAlert?: string | null;
  mechanism?: string | null;
  nearby: NearbyPlace[];
}

export interface EonetIntel {
  categories: string[];
  closed: string | null;
  firstDate: string | null;
  lastDate: string | null;
  observations: number;
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
  sources: Array<{ id: string; url: string }>;
  description: string | null;
}

export interface WikiIntel { title: string; extract: string; url: string }

export interface ReportSource { name: string; url: string; ok: boolean; note?: string }

export interface ReportSection { heading: string; lines: string[] }

export interface EventReport {
  event: GlobalEvent;
  headline: string;
  /** The short summary: what, where, when, size, depth, area, shaking, damage, displacement. */
  summary: string;
  facts: Array<{ label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad' }>;
  sections: ReportSection[];
  displacement: DisplacementEstimate;
  nearby: NearbyPlace[];
  wiki: WikiIntel | null;
  sources: ReportSource[];
  generatedAt: string;
}

// ── helpers ────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function utcStamp(ms: number) {
  const d = new Date(ms);
  return {
    date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
    iso: d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    year: d.getUTCFullYear(),
  };
}
const num = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const km2 = (a: number) => (a < 10 ? a.toFixed(1) : num(Math.round(a)));
const coord = (e: GlobalEvent) => `${Math.abs(e.lat).toFixed(2)}°${e.lat >= 0 ? 'N' : 'S'}, ${Math.abs(e.lon).toFixed(2)}°${e.lon >= 0 ? 'E' : 'W'}`;

export const PAGER_MEANING: Record<string, { fatalities: string; economic: string; word: string }> = {
  green:  { fatalities: 'fewer than 1 fatality', economic: 'under US$1 million in losses', word: 'little or no damage expected' },
  yellow: { fatalities: '1–99 fatalities', economic: 'US$1–100 million in losses', word: 'localised damage possible' },
  orange: { fatalities: '100–999 fatalities', economic: 'US$100 million–1 billion in losses', word: 'significant damage likely' },
  red:    { fatalities: '1,000 or more fatalities', economic: 'over US$1 billion in losses', word: 'extensive damage and casualties likely' },
};

const VEI_TEXT: Record<number, { ejecta: string; plume: string; word: string }> = {
  0: { ejecta: 'under 10,000 m³ of ejecta', plume: 'plume under 100 m', word: 'effusive' },
  1: { ejecta: 'more than 10,000 m³ of ejecta', plume: 'plume of 100 m–1 km', word: 'gentle' },
  2: { ejecta: 'more than 1 million m³ of ejecta', plume: 'plume of 1–5 km', word: 'explosive' },
  3: { ejecta: 'more than 10 million m³ of ejecta', plume: 'plume of 3–15 km', word: 'severe' },
  4: { ejecta: 'more than 0.1 km³ of ejecta', plume: 'plume of 10–25 km', word: 'cataclysmic' },
  5: { ejecta: 'more than 1 km³ of ejecta', plume: 'plume above 25 km', word: 'paroxysmal' },
  6: { ejecta: 'more than 10 km³ of ejecta', plume: 'plume above 25 km', word: 'colossal' },
  7: { ejecta: 'more than 100 km³ of ejecta', plume: 'plume above 25 km', word: 'super-colossal' },
  8: { ejecta: 'more than 1,000 km³ of ejecta', plume: 'plume above 25 km', word: 'mega-colossal' },
};

const STORM_IMPACT: Record<string, string> = {
  TD: 'A tropical depression is the weakest stage: heavy rain and local flooding are the main hazards.',
  TS: 'At tropical-storm strength, damaging winds, heavy rain and coastal flooding are possible, mostly to weak structures and vegetation.',
  '1': 'Category 1 winds are very dangerous and can damage roofs, trees and power lines.',
  '2': 'Category 2 winds can cause extensive damage to roofs and trees, with widespread power loss.',
  '3': 'Category 3 is a major cyclone: devastating damage to buildings is likely, with long power and water outages.',
  '4': 'Category 4 is a major cyclone: catastrophic damage is likely, with areas uninhabitable for weeks.',
  '5': 'Category 5 is the highest class: catastrophic damage is likely, and much of the affected area may be uninhabitable for months.',
};
const dimKm = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0));
function sentenceCase(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── builders ───────────────────────────────────────────────────
export interface BuildInput {
  event: GlobalEvent;
  quake?: QuakeIntel | null;
  eonet?: EonetIntel | null;
  wiki?: WikiIntel | null;
  sources: ReportSource[];
}

export function buildReport({ event: e, quake, eonet, wiki, sources }: BuildInput): EventReport {
  const t = utcStamp(e.time);
  const disp = estimateDisplacement(e);
  const seismic = e.type === 'tectonic' || e.type === 'induced_seismicity' || e.type === 'mining';
  const sentences: string[] = [];
  const sections: ReportSection[] = [];
  const facts: EventReport['facts'] = [];
  const nearby = quake?.nearby ?? [];

  facts.push({ label: 'Date & time', value: t.iso });
  facts.push({ label: 'Location', value: coord(e) });

  let headline = e.title;

  if (seismic && e.magnitude != null) {
    const m = e.magnitude, depth = e.depth;
    const r = ruptureFromMagnitude(m);
    headline = `M ${m.toFixed(1)} · ${e.title}`;
    const kind = e.type === 'induced_seismicity' ? 'human-induced earthquake' : e.type === 'mining' ? 'mining-related seismic event' : 'earthquake';

    // 1 — what, where, when, how deep
    sentences.push(
      `A magnitude ${m.toFixed(1)}${quake?.magType ? ` (${quake.magType})` : ''} ${kind} (${magClass(m)}) struck ${e.title} on ${t.date} at ${t.time} UTC` +
      (depth != null ? `, at a depth of ${num(depth, depth < 10 ? 1 : 0)} km (${depthClass(depth)}).` : '.'),
    );
    facts.push({ label: 'Magnitude', value: `M ${m.toFixed(1)}${quake?.magType ? ` ${quake.magType}` : ''}` });
    if (depth != null) facts.push({ label: 'Depth', value: `${num(depth, 1)} km`, note: depthClass(depth) });

    // 2 — area covered
    const dimL = Math.max(r.lengthKm, r.widthKm), dimW = Math.min(r.lengthKm, r.widthKm);
    const areaBits: string[] = [`The fault patch that slipped is estimated at about ${km2(r.areaKm2)} km² (roughly ${dimKm(dimL)} × ${dimKm(dimW)} km)`];
    if (r.surfaceLengthKm != null && depth != null && depth <= 30 && m >= 6) areaBits[0] += `, with up to ~${r.surfaceLengthKm.toFixed(0)} km of surface rupture possible`;
    areaBits[0] += ' (Wells & Coppersmith 1994 scaling, an estimate).';
    if (quake?.shakemapAreaKm2) areaBits.push(`The USGS ShakeMap grid for this event covers about ${km2(quake.shakemapAreaKm2)} km².`);
    sentences.push(areaBits.join(' '));
    facts.push({ label: 'Rupture area (est.)', value: `${km2(r.areaKm2)} km²`, note: `${dimKm(dimL)} × ${dimKm(dimW)} km` });
    if (quake?.shakemapAreaKm2) facts.push({ label: 'ShakeMap coverage', value: `${km2(quake.shakemapAreaKm2)} km²` });

    // 3 — shaking and reports
    const shake: string[] = [];
    if (quake?.mmi != null) shake.push(`The strongest instrumental shaking reached intensity ${roman(quake.mmi)} (${MMI_WORDS[Math.round(quake.mmi)] ?? ''})`);
    if (quake?.felt != null && quake.felt > 0) shake.push(`${num(quake.felt)} people reported feeling it${quake.cdi != null ? `, up to intensity ${roman(quake.cdi)}` : ''}`);
    if (shake.length) sentences.push(sentenceCase(shake.join('; ')) + '.');
    if (quake?.mmi != null) facts.push({ label: 'Max shaking (MMI)', value: `${roman(quake.mmi)} · ${MMI_WORDS[Math.round(quake.mmi)] ?? ''}` });
    if (quake?.felt != null) facts.push({ label: 'Felt reports', value: num(quake.felt) });
    if (quake?.maxPga != null) facts.push({ label: 'Peak ground accel.', value: `${quake.maxPga.toFixed(1)} %g` });

    // 4 — damage / destruction of property
    const alert = quake?.alert?.toLowerCase() ?? null;
    if (alert && PAGER_MEANING[alert]) {
      const p = PAGER_MEANING[alert];
      sentences.push(`USGS PAGER rates the impact ${alert.toUpperCase()} (${p.word}; estimated ${p.fatalities} and ${p.economic}).`);
      facts.push({ label: 'PAGER alert', value: alert.toUpperCase(), tone: alert === 'green' ? 'good' : alert === 'yellow' ? 'warn' : 'bad' });
    } else {
      let inferred: string;
      if (quake?.mmi != null && quake.mmi >= 7) inferred = 'shaking of this strength can damage poorly built structures';
      else if (m >= 7) inferred = 'an earthquake this large can cause serious damage if it is shallow or near settlements';
      else if (m >= 6) inferred = 'damage is possible near the epicentre if buildings are vulnerable';
      else if (m >= 5) inferred = 'light damage is possible only very close to the epicentre';
      else inferred = 'earthquakes this size rarely damage buildings';
      sentences.push(`USGS has not issued a PAGER impact assessment for this event; as a general rule, ${inferred}. No casualty or property-loss figures are reported by the sources used.`);
      facts.push({ label: 'PAGER alert', value: 'Not issued' });
    }
    if (quake?.pagerComments?.length) sections.push({ heading: 'Expected damage (USGS PAGER)', lines: quake.pagerComments });
    if (quake?.exposedMmi6Plus != null && quake.exposedMmi6Plus > 0) facts.push({ label: 'People exposed to MMI VI+', value: num(quake.exposedMmi6Plus) });
    if (quake?.tsunami) sentences.push('A tsunami message was associated with this event.');
    facts.push({ label: 'Tsunami flag', value: quake?.tsunami ? 'Yes' : 'No', tone: quake?.tsunami ? 'bad' : undefined });
    const gf: string[] = [];
    if (quake?.landslideAlert) gf.push(`landslide hazard ${quake.landslideAlert}`);
    if (quake?.liquefactionAlert) gf.push(`liquefaction hazard ${quake.liquefactionAlert}`);
    if (gf.length) sections.push({ heading: 'Secondary hazards (USGS ground failure)', lines: [sentenceCase(gf.join('; ')) + '.'] });
    if (quake?.mechanism) facts.push({ label: 'Faulting', value: quake.mechanism });

    // 5 — displacement
    sentences.push(`Surface displacement: ${disp.label.toLowerCase().replace('≈ ', 'about ')} (${disp.kind === 'negligible' ? 'modelled' : 'modelled, not measured'}; InSAR/GNSS confirmation pending).`);
    facts.push({ label: 'Surface displacement (est.)', value: disp.label, note: 'modelled, not measured' });
  } else if (e.type === 'storm') {
    const c = stormOf(e);
    headline = c ? `${c.full} · ${e.title}` : e.title;
    const prev = e.track?.length ? e.track[e.track.length - 1] : null;
    const brg = prev ? (Math.atan2(e.lon - prev[0], e.lat - prev[1]) * 180) / Math.PI : null;
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const heading = brg != null && (Math.abs(e.lon - prev![0]) + Math.abs(e.lat - prev![1])) > 0.05 ? dirs[Math.round(((brg + 360) % 360) / 45) % 8] : null;
    sentences.push(`${sentenceCase(e.title)} is ${c ? `a ${c.full}` : 'a tropical cyclone'} reported by ${e.sources.join(' & ')}, last positioned at ${coord(e)} on ${t.date}${heading ? ` and tracking ${heading}` : ''}.`);
    if (e.wind_kts != null) sentences.push(`Maximum sustained winds are about ${fmtWind(e.wind_kts)}${e.pressure_mb != null ? ` with a central pressure near ${Math.round(e.pressure_mb)} hPa` : ''}${c ? `, which falls in the ${c.label.toLowerCase()} band (${c.band})` : ''}.`);
    else sentences.push('The sources do not report a wind speed for this storm, so its intensity category is not stated.');
    if (c) sentences.push(STORM_IMPACT[c.code]);
    if (e.track?.length) sentences.push(`${e.track.length + 1} positions have been logged for this storm.`);
    if (eonet) sentences.push(`NASA EONET ${eonet.closed ? `closed this event on ${eonet.closed.slice(0, 10)}` : 'still lists this event as open'}.`);
    sentences.push('No casualty, area or property-damage figures are reported by these sources. A cyclone does not displace the ground, so there is no surface-displacement figure; its impact is wind, storm surge and flooding.');
    if (c) facts.push({ label: 'Category', value: c.full, note: `${c.band} sustained wind`, tone: c.tone });
    if (e.wind_kts != null) facts.push({ label: 'Max wind', value: fmtWind(e.wind_kts) });
    if (e.pressure_mb != null) facts.push({ label: 'Central pressure', value: `${Math.round(e.pressure_mb)} hPa` });
    facts.push({ label: 'Surface displacement', value: disp.label, note: disp.note });
  } else if (e.type === 'volcanic') {
    const vei = e.magnitude != null ? Math.round(e.magnitude) : null;
    headline = vei != null ? `VEI ${vei} · ${e.title}` : e.title;
    sentences.push(`${e.title} was recorded by ${e.sources.join(' & ')} on ${t.date}${vei != null ? `, rated VEI ${vei}` : ''}.`);
    if (vei != null && VEI_TEXT[vei]) {
      const v = VEI_TEXT[vei];
      sentences.push(`On the Volcanic Explosivity Index that is ${/^[aeiou]/i.test(v.word) ? 'an' : 'a'} ${v.word} eruption: ${v.ejecta} and a ${v.plume}.`);
      facts.push({ label: 'VEI', value: String(vei), note: v.word });
      facts.push({ label: 'Ejecta (VEI class)', value: v.ejecta.replace('more than ', '> ').replace('under ', '< ') });
    } else {
      sentences.push('The catalogue gives no explosivity (VEI) rating for this record, so eruption size and ash coverage are not stated.');
    }
    if (eonet?.categories?.length) sentences.push(`NASA EONET lists it under ${eonet.categories.join(', ')}${eonet.closed ? ' and marks it closed' : ' and still shows it open'}.`);
    sentences.push('No casualty or property-damage figures are reported by these sources, and surface deformation (inflation or deflation of the edifice) needs InSAR or GNSS, which are not yet ingested.');
    facts.push({ label: 'Surface displacement', value: disp.label, note: disp.note });
  } else {
    const label = e.type === 'landslide' ? 'landslide' : e.type === 'cryosphere' ? 'cryosphere event' : e.type === 'subsidence' ? 'ground-subsidence record' : e.type === 'tsunami' ? 'tsunami event' : 'event';
    sentences.push(`${sentenceCase(e.title)} is a ${label} recorded by ${e.sources.join(' & ')}${e.cause === 'human' ? ' and attributed to human activity' : ''}, dated ${t.date}.`);
    if (e.magnitude != null && e.depth != null) sentences.push(`Reported magnitude ${e.magnitude.toFixed(1)} at ${num(e.depth, 0)} km depth.`);
    if (eonet) {
      const extent = eonet.magnitudeValue != null ? ` Reported size: ${num(eonet.magnitudeValue, 1)} ${eonet.magnitudeUnit ?? ''}.`.replace(/NM\^2|NM2/, 'nmi²') : '';
      sentences.push(`NASA EONET shows ${eonet.observations} observation${eonet.observations === 1 ? '' : 's'}${eonet.firstDate && eonet.lastDate && eonet.firstDate !== eonet.lastDate ? ` between ${eonet.firstDate.slice(0, 10)} and ${eonet.lastDate.slice(0, 10)}` : ''}${eonet.closed ? `; it was closed on ${eonet.closed.slice(0, 10)}` : '; it is still open'}.${extent}`);
      if (eonet.magnitudeValue != null) facts.push({ label: 'Area / size (EONET)', value: `${num(eonet.magnitudeValue, 1)} ${eonet.magnitudeUnit ?? ''}`.trim() });
    }
    sentences.push('The catalogue snapshot used here does not include casualty, property-loss or area figures for this record.');
    sentences.push(`Surface displacement is not available for this record: ${disp.note.charAt(0).toLowerCase()}${disp.note.slice(1)}`);
    facts.push({ label: 'Surface displacement', value: disp.label, note: disp.note });
  }

  if (nearby.length) {
    const top = nearby.slice(0, 3).map(n => `${n.name} (${num(n.distanceKm)} km ${n.direction}${n.population ? `, pop. ${num(n.population)}` : ''})`);
    sections.push({ heading: 'Nearest places', lines: top });
  }
  if (wiki) sections.push({ heading: 'Background', lines: [wiki.extract.length > 520 ? wiki.extract.slice(0, 517) + '…' : wiki.extract] });

  facts.push({ label: 'Reported by', value: e.sources.join(' + ') });
  if (quake?.status) facts.push({ label: 'Review status', value: quake.status.toUpperCase() });

  return {
    event: e,
    headline,
    summary: sentences.join(' '),
    facts,
    sections,
    displacement: disp,
    nearby,
    wiki: wiki ?? null,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

export { fmtDisp };
