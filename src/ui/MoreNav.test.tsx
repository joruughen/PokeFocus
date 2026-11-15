import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { badgeTotal, MoreList, MoreNav, PRIMARY_NAV, splitNav } from './MoreNav'
import { ROUTES } from './routes'

describe('splitNav', () => {
  it('keeps the four main sections in the bar, in order, and the rest in More', () => {
    const { primary, more } = splitNav(ROUTES)
    expect(primary.map((r) => r.id)).toEqual([...PRIMARY_NAV])
    expect(more.map((r) => r.id)).toEqual(['profile', 'bag', 'dex', 'league', 'friends', 'trades', 'events', 'settings'])
    // 4 sections + the More button = 5 buttons on a phone; nothing is lost.
    expect(primary.length + 1).toBe(5)
    // Profile is the only extra: it has no rail entry (desktop reaches it from the trainer card).
    expect(primary.length + more.length).toBe(ROUTES.filter((r) => r.nav).length + 1)
  })

  it('adds Administration for staff only', () => {
    expect(splitNav(ROUTES, 'player').more.some((r) => r.id === 'admin')).toBe(false)
    expect(splitNav(ROUTES, null).more.some((r) => r.id === 'admin')).toBe(false)
    expect(splitNav(ROUTES, 'admin').more.at(-1)!.id).toBe('admin')
    expect(splitNav(ROUTES, 'support').more.at(-1)!.id).toBe('admin')
  })

  it('sums the badges of the sections inside More only', () => {
    const { more } = splitNav(ROUTES)
    expect(badgeTotal(more, { friends: 2, events: 1, missions: 5 })).toBe(3)
    expect(badgeTotal(more, {})).toBe(0)
  })
})

describe('More sheet', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`lists every section as a link with its badge, current page marked (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const { more } = splitNav(ROUTES)
      const html = renderToStaticMarkup(<MoreList routes={more} route="friends" badges={{ friends: 2, events: 1 }} />)
      for (const r of more) expect(html).toContain(`href="#/${r.id}"`)
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
      expect(html).toContain(lng === 'es' ? '2 solicitudes de amistad' : '2 friend requests')
      expect(html).toContain(lng === 'es' ? '1 evento en curso' : '1 event running')
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/nav\.[a-zA-Z.]+/)
    })

    it(`the phone bar button says More, with the badge total, closed by default (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const { more } = splitNav(ROUTES)
      const html = renderToStaticMarkup(<MoreNav routes={more} route="home" badges={{ friends: 2, events: 1 }} />)
      expect(html).toContain(lng === 'es' ? 'Más' : 'More')
      expect(html).toContain(lng === 'es' ? '3 avisos' : '3 alerts')
      expect(html).toMatch(/aria-expanded="false"/)
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/nav\.[a-zA-Z.]+/)
    })
  }
})
