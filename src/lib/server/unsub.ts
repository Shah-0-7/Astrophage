import { hmac, hmacVerify } from './crypto';

/** Unsubscribe links carry an HMAC of the user id, so they work without signing in and cannot be forged. */
export const unsubToken = (secret: string, userId: string) => hmac(secret, `unsub:${userId}`);
export const verifyUnsubToken = (secret: string, userId: string, token: string) => hmacVerify(secret, `unsub:${userId}`, token);
export async function unsubscribeUrl(origin: string, secret: string, userId: string): Promise<string> {
  return `${origin}/api/alerts/unsubscribe?u=${encodeURIComponent(userId)}&t=${await unsubToken(secret, userId)}`;
}
