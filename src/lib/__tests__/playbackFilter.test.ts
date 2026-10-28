import { describe, it, expect } from 'vitest';
import { filterByPlayback, windowRange, cutoffInRange } from '@/lib/playbackFilter';

describe('playback windows', () => {
  const H = 3_600_000, now = 1_000_000 * H;
  const ev = [{ t: now - 30 * H }, { t: now - 20 * H }, { t: now - 10 * H }, { t: now - 1 * H }];
  const range = windowRange('24h', now)!;
  it('builds ranges ending at the anchor', () => {
    expect(range).toEqual({ start: now - 24 * H, end: now });
    expect(windowRange('all', now)).toBeNull();
    expect(windowRange('24h', 0)).toBeNull();
  });
  it('hides events older than the window at any position', () => {
    expect(filterByPlayback(ev, e => e.t, 1, range).map(e => e.t)).toEqual([now - 20 * H, now - 10 * H, now - 1 * H]);
  });
  it('reveals events as the scrubber passes them', () => {
    expect(filterByPlayback(ev, e => e.t, 0, range)).toEqual([]);
    expect(filterByPlayback(ev, e => e.t, 0.5, range).map(e => e.t)).toEqual([now - 20 * H]);
    expect(cutoffInRange(range, 0.5)).toBe(now - 12 * H);
  });
  it('keeps feed-span behaviour without a range', () => {
    expect(filterByPlayback(ev, e => e.t, 1)).toHaveLength(4);
    expect(filterByPlayback(ev, e => e.t, 0)).toHaveLength(1);
  });
});
