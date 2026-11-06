/** Server-side CMR calls. Never throws: a CMR outage becomes `ok: false` so callers can show a "not available" state. */
import { buildGranuleUrl, parseGranules, type GranuleQuery } from './cmr';
import type { NisarScene } from './types';

export interface SceneResult { ok: boolean; scenes: NisarScene[]; hits: number; error?: string }

const UA = { 'Client-Id': 'astrophage-observatory', Accept: 'application/vnd.nasa.cmr.umm_results+json' };

export async function queryScenes(q: GranuleQuery, fetchImpl: typeof fetch = fetch): Promise<SceneResult> {
  try {
    const res = await fetchImpl(buildGranuleUrl(q), { headers: UA, signal: AbortSignal.timeout(9000), next: { revalidate: 900 } } as RequestInit);
    if (!res.ok) return { ok: false, scenes: [], hits: 0, error: `CMR responded ${res.status}` };
    const scenes = parseGranules(await res.json());
    const hits = Number(res.headers.get('CMR-Hits'));
    return { ok: true, scenes, hits: Number.isFinite(hits) && hits > 0 ? hits : scenes.length };
  } catch (e) {
    return { ok: false, scenes: [], hits: 0, error: e instanceof Error ? e.message : 'CMR request failed' };
  }
}
