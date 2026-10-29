'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalEvent } from '@/lib/globalEvents';
import type { Account } from '@/lib/useAccount';
import {
  alertText, findAlerts, loadNotified, loadRules, loadSeen, mergeRules, newRule, saveNotified, saveRules, saveSeen, shouldNotify,
  type WatchAlert, type WatchRule,
} from '@/lib/watchlist';

export type NotifyState = 'unsupported' | 'default' | 'granted' | 'denied';

export const WATCH_ADD_EVENT = 'ob-watch-add';

function notifySupport(): NotifyState {
  try { return typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as NotifyState); } catch { return 'unsupported'; }
}

/**
 * Watch rules + alerts for the events currently loaded. Everything lives in this browser: rules in
 * localStorage, alerts computed from the live feed, and browser notifications only while the app is open.
 */
export function useWatchlist(events: GlobalEvent[], account?: Account) {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [notify, setNotify] = useState<NotifyState>('unsupported');
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const notified = useRef<Set<string>>(new Set());

  // Clock for "recent" checks, refreshed whenever the feed changes (keeps render pure).
  useEffect(() => { setNow(Date.now()); }, [events]);

  useEffect(() => {
    setRules(loadRules());
    setSeen(new Set(loadSeen()));
    notified.current = new Set(loadNotified());
    setNotify(notifySupport());
    setReady(true);
  }, []);

  const alerts: WatchAlert[] = useMemo(() => findAlerts(rules, events, now), [rules, events, now]);
  const unread = useMemo(() => alerts.filter(a => !seen.has(a.event.id)), [alerts, seen]);

  // The rule list is kept in this browser and, when signed in, saved to the account too.
  const rulesRef = useRef<WatchRule[]>([]);
  useEffect(() => { rulesRef.current = rules; }, [rules]);
  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);

  const commit = useCallback((next: WatchRule[]) => {
    rulesRef.current = next;
    setRules(next); saveRules(next);
    if (accountRef.current?.user) void accountRef.current.pushRules(next);
  }, []);
  const addRule = useCallback((partial: Partial<WatchRule>) => {
    const rule = newRule(partial);
    commit([...rulesRef.current, rule]);
    return rule;
  }, [commit]);
  const removeRule = useCallback((id: string) => { commit(rulesRef.current.filter(r => r.id !== id)); }, [commit]);

  // First time we see a signed-in user: combine this browser's rules with the account's, and save the result.
  const syncedFor = useRef<string | null>(null);
  const userId = account?.user?.id ?? null;
  useEffect(() => {
    if (!account?.loaded || !ready) return;
    if (!userId) { syncedFor.current = null; return; }
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;
    const merged = mergeRules(account.serverRules, rulesRef.current);
    rulesRef.current = merged; setRules(merged); saveRules(merged);
    if (merged.length !== account.serverRules.length) void account.pushRules(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.loaded, userId, ready]);

  // Signing out or deleting the account leaves nothing of it behind on this device.
  const hadUser = useRef(false);
  useEffect(() => {
    if (userId) { hadUser.current = true; return; }
    if (hadUser.current && account?.loaded) { hadUser.current = false; rulesRef.current = []; setRules([]); saveRules([]); }
  }, [userId, account?.loaded]);

  // Returning from Google opens the panel so the outcome is visible.
  useEffect(() => { if (account?.returned) setOpen(true); }, [account?.returned]);
  const markRead = useCallback((ids?: string[]) => {
    setSeen(prev => {
      const next = new Set(prev);
      for (const id of ids ?? alerts.map(a => a.event.id)) next.add(id);
      saveSeen([...next]);
      return next;
    });
  }, [alerts]);

  const enableNotifications = useCallback(async () => {
    try {
      if (typeof Notification === 'undefined') return;
      const p = await Notification.requestPermission();
      setNotify(p as NotifyState);
    } catch { setNotify('unsupported'); }
  }, []);

  // Let other parts of the UI (e.g. the ledger's "Watch these filters") add a rule and open the panel.
  useEffect(() => {
    const on = (e: Event) => { addRule((e as CustomEvent<Partial<WatchRule>>).detail ?? {}); setOpen(true); };
    window.addEventListener(WATCH_ADD_EVENT, on);
    return () => window.removeEventListener(WATCH_ADD_EVENT, on);
  }, [addRule]);

  // Raise browser notifications for matches not announced before. Several at once collapse into one.
  useEffect(() => {
    if (!ready || notify !== 'granted' || events.length === 0) return;
    const fresh = alerts.filter(a => !notified.current.has(a.event.id) && shouldNotify(a.rule, a.event));
    if (!fresh.length) return;
    fresh.forEach(a => notified.current.add(a.event.id));
    saveNotified([...notified.current]);
    try {
      const open = () => { window.focus(); };
      if (fresh.length === 1) {
        const t = alertText(fresh[0].event);
        const n = new Notification(t.title, { body: t.body, tag: fresh[0].event.id });
        n.onclick = open;
      } else {
        const n = new Notification(`${fresh.length} new events match your watchlist`, { body: fresh.slice(0, 3).map(a => alertText(a.event).title + ' · ' + a.event.title).join('\n'), tag: 'ob-watch-batch' });
        n.onclick = open;
      }
    } catch { /* notifications blocked in this context */ }
  }, [alerts, notify, ready, events.length]);

  return { rules, alerts, unread, addRule, removeRule, markRead, open, setOpen, notify, enableNotifications, account };
}
export type Watchlist = ReturnType<typeof useWatchlist>;
