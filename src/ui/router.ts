/**
 * Tiny hash router: `#/box` → route id "box". No dependency, survives reloads,
 * keeps `?dev` in the query string untouched. Screens are declared in routes.tsx.
 */
import { useSyncExternalStore } from 'react'

function read(): string {
  const h = typeof location !== 'undefined' ? location.hash.replace(/^#\/?/, '') : ''
  return h.split('/')[0] || 'home'
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Current route id ("home" by default). */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, read, () => 'home')
}

/** Extra path segments after the id (`#/box/p12` → ["p12"]), for detail views. */
export function useRouteParams(): string[] {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '')
  return hash.replace(/^#\/?/, '').split('/').slice(1).filter(Boolean)
}

export function navigate(id: string, ...params: string[]): void {
  const next = `#/${[id, ...params].join('/')}`
  if (location.hash !== next) location.hash = next
}

export function hrefTo(id: string, ...params: string[]): string {
  return `#/${[id, ...params].join('/')}`
}
