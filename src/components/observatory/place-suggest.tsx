'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchPlaces, type Place } from '@/lib/placeSearch';
import './place-suggest.css';

export function placeLabel(p: Place): string {
  return `${p.name}`;
}
function where(p: Place) {
  return `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;
}

/** Dropdown of matching places under a text query. Arrow keys + Enter pick; the parent owns the input. */
export function PlaceSuggest({ query, onPick, inputRef }: { query: string; onPick: (p: Place) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const touched = useRef(false);
  const results = useMemo(() => searchPlaces(query, 6), [query]);
  const open = results.length > 0 && dismissed !== query;

  useEffect(() => { setActive(0); touched.current = false; }, [query]);
  useEffect(() => {
    const input = inputRef?.current;
    if (!input) return;
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); touched.current = true; setActive(a => (a + 1) % results.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); touched.current = true; setActive(a => (a - 1 + results.length) % results.length); }
      else if (e.key === 'Enter' && touched.current) { e.preventDefault(); onPick(results[active]); }
      else if (e.key === 'Escape') setDismissed(query);
    };
    input.addEventListener('keydown', onKey);
    return () => input.removeEventListener('keydown', onKey);
  }, [inputRef, open, results, active, onPick, query]);

  if (!open) return null;
  return (
    <ul className="ps" role="listbox" id={id} aria-label="Matching places">
      {results.map((p, i) => (
        <li key={`${p.name}${p.lat}${p.lon}`} role="option" aria-selected={i === active}>
          <button type="button" data-on={i === active} onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => onPick(p)}>
            <span>{p.name}{p.capital && <em>CAPITAL</em>}</span><small>{where(p)}</small>
          </button>
        </li>
      ))}
      <li className="ps-hint" aria-hidden="true">↑↓ then Enter to jump · Esc to close</li>
    </ul>
  );
}
