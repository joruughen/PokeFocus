/** The support-gift window and the content-note window: when they show (pure), the text (plain, never HTML), ES + EN. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { PendingGift } from '../../engine'
import type { ContentNoteNotice } from '../../game/protocol'
import { useAnnouncements } from '../store/announcements'
import { ContentNoteBody, GiftBody } from './NoticeHosts'
import { contentNoteOwed, decideNotice, noteText, type NoticeContext } from './notices'

const RAW_KEY = /\b(gift|contentNote|items)\.[a-zA-Z]+\b(?![^<]*>)/

const calm = (over: Partial<NoticeContext> = {}): NoticeContext => ({ owed: true, phase: 'idle', hintOpen: false, otherDialogOpen: false, whatsNewPending: false, levelUpPending: false, ...over })

describe('decideNotice', () => {
  it('nothing owed: none', () => {
    expect(decideNotice(calm({ owed: false }))).toBe('none')
  })

  it('shows when calm (idle or results)', () => {
    expect(decideNotice(calm())).toBe('show')
    expect(decideNotice(calm({ phase: 'results' }))).toBe('show')
  })

  it('waits during a session, waves, a break, a hint, another dialog, What\'s new, a level-up or (for the note) a gift', () => {
    for (const phase of ['focus', 'paused', 'claiming', 'encounter', 'break']) expect(decideNotice(calm({ phase })), phase).toBe('wait')
    for (const over of [{ hintOpen: true }, { otherDialogOpen: true }, { whatsNewPending: true }, { levelUpPending: true }, { giftPending: true }]) expect(decideNotice(calm(over)), JSON.stringify(over)).toBe('wait')
  })
})

describe('note text and the once-per-device rule', () => {
  it('picks the language, falling back to the other one', () => {
    expect(noteText({ es: 'Hola', en: 'Hi' }, 'es')).toBe('Hola')
    expect(noteText({ es: 'Hola', en: 'Hi' }, 'en')).toBe('Hi')
    expect(noteText({ en: 'Hi' }, 'es')).toBe('Hi')
    expect(noteText({ es: 'Hola' }, 'en')).toBe('Hola')
    expect(noteText(undefined, 'en')).toBe('')
  })

  it('a note is owed only when its version is newer than the last one shown', () => {
    const n: ContentNoteNotice = { versionId: 7, effectiveAt: 1, note: { en: 'x' } }
    expect(contentNoteOwed(null, 0)).toBeNull()
    expect(contentNoteOwed(n, 6)).toBe(n)
    expect(contentNoteOwed(n, 7)).toBeNull()
    expect(contentNoteOwed(n, 9)).toBeNull()
  })
})

describe('announcements store: seen notes', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    mem.clear()
    useAnnouncements.setState({ noteSeen: 0, contentNote: null })
  })

  it('remembers the highest version shown, in memory and on the device, and never goes back', () => {
    useAnnouncements.getState().markNoteSeen(5)
    useAnnouncements.getState().markNoteSeen(3)
    expect(useAnnouncements.getState().noteSeen).toBe(5)
    expect(mem.get('pokefocus:contentNote:seen')).toBe('5')
  })
})

describe('the windows (ES + EN)', () => {
  const gift: PendingGift = { items: { potion: 2 }, dust: 30, message: { es: 'Gracias por ayudarnos', en: 'Thanks for helping us' }, at: 5 }

  for (const lng of ['es', 'en'] as const) {
    it(`gift window: message, rewards and no raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<GiftBody gifts={[gift]} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'Gracias por ayudarnos' : 'Thanks for helping us')
      expect(html).toContain('×2')
      expect(html).toContain('+30')
      expect(html).toContain(i18n.t('gift.added'))
    })

    it(`content note window shows the note and no raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<ContentNoteBody notice={{ versionId: 1, effectiveAt: 1, note: { es: 'Más legendarios', en: 'More legendaries' } }} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'Más legendarios' : 'More legendaries')
      expect(html).toContain(i18n.t('contentNote.label'))
    })
  }

  it('renders the text as text: HTML in a message is escaped, never markup', async () => {
    await i18n.changeLanguage('en')
    const evil = '<img src=x onerror=alert(1)>'
    const g = renderToStaticMarkup(<GiftBody gifts={[{ ...gift, message: { en: evil } }]} />)
    const n = renderToStaticMarkup(<ContentNoteBody notice={{ versionId: 1, effectiveAt: 1, note: { en: evil } }} />)
    for (const html of [g, n]) {
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    }
  })
})
