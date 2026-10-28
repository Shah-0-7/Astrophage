import placesRaw from '@/data/places.json';

export interface Place { name: string; lon: number; lat: number; capital: boolean; rank: number }

type Row = [string, number, number, number, number];

let index: { place: Place; key: string }[] | null = null;

/** Lower-case, accent-free form for matching ("São Paulo" ~ "sao paulo"). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function build() {
  // Lower min_zoom = bigger place; use it as the ranking weight (capitals first).
  index = (placesRaw as Row[]).map(r => ({
    place: { name: r[0], lon: r[1], lat: r[2], capital: r[4] === 1, rank: r[3] },
    key: normalize(r[0]),
  }));
}

/**
 * Find places by name. Exact match first, then names starting with the query, then names containing it.
 * Within a group, national capitals and bigger places come first. Duplicate names (Springfield, London)
 * are kept, because they are different places, and the caller shows the coordinates to tell them apart.
 */
export function searchPlaces(query: string, limit = 6): Place[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  if (!index) build();
  const scored: { p: Place; s: number }[] = [];
  for (const { place, key } of index!) {
    let tier = -1;
    if (key === q) tier = 0;
    else if (key.startsWith(q)) tier = 1;
    else if (key.split(/[\s-]+/).some(w => w.startsWith(q))) tier = 2;
    else if (q.length >= 3 && key.includes(q)) tier = 3;
    if (tier < 0) continue;
    scored.push({ p: place, s: tier * 100 + place.rank * 4 - (place.capital ? 20 : 0) });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, limit).map(x => x.p);
}

/** Nearest bundled place (towns and cities, not hamlets) within `maxKm`, or null. Used to name a landfall point. */
export function nearestPlace(lat: number, lon: number, maxKm = 150): (Place & { km: number }) | null {
  if (!index) build();
  const r = Math.PI / 180;
  let best: (Place & { km: number }) | null = null;
  for (const { place } of index!) {
    if (place.rank > 4.2) continue;
    const dLat = (place.lat - lat) * r, dLon = (place.lon - lon) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * r) * Math.cos(place.lat * r) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (km <= maxKm && (!best || km < best.km)) best = { ...place, km };
  }
  return best;
}
