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

export function filterByPlayback<T>(
  items: T[],
  getTimeMs: (item: T) => number,
  progress: number,
): T[] {
  if (items.length === 0) return items;
  const clamped = Math.max(0, Math.min(1, progress));

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
