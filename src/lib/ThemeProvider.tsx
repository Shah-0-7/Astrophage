/**
 * ThemeProvider – manages dark/light theme across the entire app.
 *
 * Strategy:
 *  - On first visit, reads prefers-color-scheme.
 *  - After manual choice, persists to localStorage ('nisar-theme').
 *  - Listens for system changes only when the user hasn't chosen.
 *  - Sets data-theme="dark"|"light" on <html> before paint (via
 *    an inline script injected in layout.tsx).
 *  - Exposes useTheme() hook for toggle button and theme-reactive
 *    Three.js / canvas code.
 */

'use client';

import {
  createContext, useCallback, useContext, useEffect, useState,
} from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme:    Theme;
  toggle:   () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme:    'dark',
  toggle:   () => {},
  setTheme: () => {},
});

const LS_KEY = 'nisar-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(LS_KEY) as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, _setTheme] = useState<Theme>('dark'); // SSR safe default
  const [hasManual, setHasManual] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    const initial = getInitialTheme();
    _setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', initial === 'light' ? '#F8F7F4' : '#09090b'
    );
    const stored = localStorage.getItem(LS_KEY);
    setHasManual(!!stored);
  }, []);

  // Listen for system preference changes (only when no manual choice)
  useEffect(() => {
    if (hasManual) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      const next: Theme = e.matches ? 'light' : 'dark';
      _setTheme(next);
      document.documentElement.setAttribute('data-theme', next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [hasManual]);

  const setTheme = useCallback((t: Theme) => {
    _setTheme(t);
    setHasManual(true);
    localStorage.setItem(LS_KEY, t);
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', t === 'light' ? '#F8F7F4' : '#09090b'
    );
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
