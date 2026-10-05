/**
 * ============================================================
 * Redis Singleton Client
 * ============================================================
 * Wraps ioredis with graceful fallback – if Redis is not
 * available the app degrades to direct API polling.
 * Exported helpers:
 *   getRedis()   – returns the shared client (or null)
 *   publish()    – publish a message to a channel
 *   subscribe()  – subscribe to a channel with a callback
 * ============================================================
 */

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let _client: Redis | null = null;
let _connectionFailed = false;

/** Lazily connect; returns null if Redis is unavailable */
export function getRedis(): Redis | null {
  if (_connectionFailed) return null;
  if (_client) return _client;

  try {
    _client = new Redis(REDIS_URL, {
      lazyConnect:        true,
      enableReadyCheck:   true,
      maxRetriesPerRequest: 1,
      connectTimeout:     2000,
      retryStrategy:      () => null, // don't retry on failure
    });

    _client.on('error', (err) => {
      if (!_connectionFailed) {
        console.warn('[redis] unavailable, falling back to direct API polling:', err.message);
        _connectionFailed = true;
        _client = null;
      }
    });

    _client.connect().catch(() => {
      _connectionFailed = true;
      _client = null;
    });

    return _client;
  } catch {
    _connectionFailed = true;
    return null;
  }
}

export const STREAM_CHANNEL = 'nisar:telemetry';

/** Publish a serialised payload string to the stream channel */
export async function publish(payload: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(STREAM_CHANNEL, payload);
  } catch (err) {
    console.error('[redis] publish error:', err);
  }
}

/** Subscribe to the stream channel; returns an unsubscribe function */
export function subscribe(
  onMessage: (payload: string) => void,
): () => void {
  const redis = getRedis();
  if (!redis) return () => {};

  const sub = redis.duplicate();
  sub.subscribe(STREAM_CHANNEL).catch(console.error);
  sub.on('message', (_channel: string, message: string) => {
    onMessage(message);
  });

  return () => {
    sub.unsubscribe(STREAM_CHANNEL).catch(() => {});
    sub.disconnect();
  };
}
