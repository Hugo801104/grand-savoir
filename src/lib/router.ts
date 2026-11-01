// Navigation par l'ancre de l'URL (#/...) : le bouton « retour » d'Android fonctionne naturellement.
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string;
  params: Record<string, string>;
}

function parse(): Route {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

let current = parse();
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse();
    listeners.forEach((l) => l());
    window.scrollTo(0, 0);
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function href(path: string, params?: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function go(path: string, params?: Record<string, string | number | undefined>, replace = false) {
  const h = href(path, params);
  if (replace) location.replace(h);
  else location.hash = h;
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback);
}
