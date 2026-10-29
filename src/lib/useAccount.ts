'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchRule } from '@/lib/watchlist';

export interface AccountUser { id: string; email: string; name: string; picture: string; emailAlerts: boolean }
export interface Notice { kind: 'ok' | 'error'; text: string }

const AUTH_MESSAGES: Record<string, Notice> = {
  ok: { kind: 'ok', text: 'Signed in. Your rules are saved to your account.' },
  failed: { kind: 'error', text: 'Sign-in did not complete. Please try again.' },
  cancelled: { kind: 'error', text: 'Sign-in was cancelled.' },
};

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let data: Record<string, unknown> = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 0, data: { error: 'Network error. Check your connection and try again.' } }; }
}
const errorText = (r: { data: Record<string, unknown> }, fallback: string) => (typeof r.data.error === 'string' ? r.data.error : fallback);

/** Sign-in state and account actions. The server decides whether accounts exist on this deployment. */
export function useAccount() {
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [serverRules, setServerRules] = useState<WatchRule[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; started.current = true;
    // Coming back from Google: show the outcome, then tidy the URL.
    try {
      const u = new URL(window.location.href), a = u.searchParams.get('auth');
      if (a && AUTH_MESSAGES[a]) {
        setNotice(AUTH_MESSAGES[a]); setReturned(true);
        u.searchParams.delete('auth');
        window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch { /* ignore */ }
    void (async () => {
      const r = await call('/api/auth/me', 'GET');
      if (r.ok) {
        setConfigured(r.data.configured === true); setEmailConfigured(r.data.emailConfigured === true);
        setUser((r.data.user as AccountUser | null) ?? null);
        setServerRules(Array.isArray(r.data.rules) ? (r.data.rules as WatchRule[]) : []);
      }
      setLoaded(true);
    })();
  }, []);

  const signIn = useCallback(() => {
    const here = new URL(window.location.href); here.searchParams.delete('auth');
    window.location.assign(`/api/auth/google?returnTo=${encodeURIComponent(here.pathname + here.search)}`);
  }, []);

  const signOut = useCallback(async () => {
    setBusy('signout');
    await call('/api/auth/logout', 'POST');
    setUser(null); setServerRules([]); setNotice({ kind: 'ok', text: 'Signed out.' }); setBusy(null);
  }, []);

  const setEmailAlerts = useCallback(async (on: boolean) => {
    setBusy('email');
    const r = await call('/api/account', 'PATCH', { emailAlerts: on });
    if (r.ok) { setUser(r.data.user as AccountUser); setNotice({ kind: 'ok', text: on ? 'Email alerts are on.' : 'Email alerts are off. Your rules stay saved.' }); }
    else setNotice({ kind: 'error', text: errorText(r, 'Could not change that setting.') });
    setBusy(null);
  }, []);

  const sendTest = useCallback(async () => {
    setBusy('test');
    const r = await call('/api/alerts/test', 'POST');
    setNotice(r.ok ? { kind: 'ok', text: `Test email sent to ${String(r.data.to ?? 'you')}. Check your inbox (and spam).` } : { kind: 'error', text: errorText(r, 'Could not send the test email.') });
    setBusy(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    setBusy('delete');
    const r = await call('/api/account', 'DELETE');
    if (r.ok) { setUser(null); setServerRules([]); setNotice({ kind: 'ok', text: 'Your account and its data were deleted.' }); }
    else setNotice({ kind: 'error', text: errorText(r, 'Could not delete the account.') });
    setBusy(null);
    return r.ok;
  }, []);

  /** Save the full rule list to the account. */
  const pushRules = useCallback(async (rules: WatchRule[]) => {
    const r = await call('/api/watch/rules', 'PUT', { rules });
    if (!r.ok) setNotice({ kind: 'error', text: errorText(r, 'Your rules could not be saved to your account. They are still saved in this browser.') });
    return r.ok;
  }, []);

  return { loaded, configured, emailConfigured, user, serverRules, notice, setNotice, busy, returned, signIn, signOut, setEmailAlerts, sendTest, deleteAccount, pushRules };
}
export type Account = ReturnType<typeof useAccount>;
