/**
 * ============================================================
 * Playback time filter
 * ============================================================
 * Maps the pass-scrubber's progress (0–1) onto an event feed's
 * actual time span, returning only events at or before the
 * cutoff so events appear chronologically during playback.
 * Items with an unparseable timestamp always remain visible.
 * ============================================================
 */

export type PlaybackWindowId = 'all' | '24h' | '7d';

export const PLAYBACK_WINDOWS: { id: PlaybackWindowId; label: string; ms: number | null }[] = [
  { id: '24h', label: '24H', ms: 24 * 3_600_000 },
  { id: '7d',  label: '7D',  ms: 7 * 86_400_000 },
  { id: 'all', label: 'ALL', ms: null },
];

/** The wall-clock span a window covers, ending at `anchor`; null for the whole feed. */
export function windowRange(id: PlaybackWindowId, anchor: number): { start: number; end: number } | null {
  const ms = PLAYBACK_WINDOWS.find(w => w.id === id)?.ms ?? null;
  return ms == null || !Number.isFinite(anchor) || anchor <= 0 ? null : { start: anchor - ms, end: anchor };
}

/** Time at the scrubber's position inside a fixed range. */
export function cutoffInRange(range: { start: number; end: number }, progress: number): number {
  return range.start + (range.end - range.start) * Math.max(0, Math.min(1, progress));
}

/**
 * With a `range` the scrubber sweeps that fixed span (events before it are hidden, the rest appear as the
 * scrubber passes them). Without one it sweeps the span of whatever the feed holds.
 */
export function filterByPlayback<T>(
  items: T[],
  getTimeMs: (item: T) => number,
  progress: number,
  range?: { start: number; end: number } | null,
): T[] {
  if (items.length === 0) return items;
  const clamped = Math.max(0, Math.min(1, progress));

  if (range) {
    const cut = cutoffInRange(range, clamped);
    return items.filter(item => {
      const t = getTimeMs(item);
      return !Number.isFinite(t) || (t >= range.start && t <= cut);
    });
  }

  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const t = getTimeMs(item);
    if (!Number.isFinite(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return items;

  const span = max - min;
  if (span <= 0) return items; // all events share one timestamp

  const cutoff = min + span * clamped;
  return items.filter(item => {
    const t = getTimeMs(item);
    return !Number.isFinite(t) || t <= cutoff;
  });
}
