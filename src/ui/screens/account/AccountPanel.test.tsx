/**
 * Render test of the account panel (server-side render, no DOM): the free
 * state, a locked name, a locked country, both locked, the dev bypass and the
 * anonymous switch, in Spanish and English, with no raw i18n keys.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { NAME_LOCK_DAYS, COUNTRY_LOCK_DAYS, type PublicUser } from '../../../game/protocol'
import { useAuth } from '../../store/auth'
import { usePrefs } from '../../store/prefs'
import { AccountPanel } from './AccountPanel'

const DAY = 86_400_000

function user(patch: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u1',
    email: 'ash@example.com',
    trainerName: 'Ash',
    country: 'PE',
    friendCode: 'ABCD2345',
    createdAt: 0,
    nameChangedAt: null,
    countryChangedAt: null,
    anonymousRankings: false,
    role: 'player',
    ...patch,
  }
}

/** Server rendering reads a zustand store's *initial* state, so patch that object in place. */
function render(u: PublicUser): string {
  Object.assign(useAuth.getInitialState(), { status: 'authed', user: u })
  return renderToStaticMarkup(<AccountPanel />)
}

const longDate = (lng: string, at: number) => new Intl.DateTimeFormat(lng, { dateStyle: 'long' }).format(at)
const RAW_KEY = /\b(account|auth|leaderboard|common|errors)\.[a-zA-Z]/
const nameInput = (html: string) => /<input[^>]*autoComplete="nickname"[^>]*>/.exec(html)![0]
/** The `disabled` attribute (not the `disabled:` Tailwind variants in the class list). */
const isDisabled = (tag: string) => / disabled(=""|\s|\/|>)/.test(tag)
const switchTag = (html: string) => /<(?:button|span)[^>]*role="switch"[^>]*>/.exec(html)![0]
/** What `renderToStaticMarkup` does to text: apostrophes and quotes are escaped. */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')

beforeEach(() => {
  usePrefs.setState((s) => ({ dev: { ...s.dev, panelOpen: false } }))
})
afterEach(() => {
  usePrefs.setState((s) => ({ dev: { ...s.dev, panelOpen: false } }))
  Object.assign(useAuth.getInitialState(), { status: 'loading', user: null })
})

describe('AccountPanel', () => {
  for (const lng of ['es', 'en'] as const) {
    const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, { lng, ...o })

    describe(lng, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(lng)
      })

      it('free: both fields are editable and the 30-day lock is announced up front', () => {
        const html = render(user())
        expect(html).not.toMatch(RAW_KEY)
        expect(isDisabled(nameInput(html))).toBe(false)
        expect(html).toContain(esc(t('account.lockHint', { days: NAME_LOCK_DAYS })))
        expect(html).not.toContain(esc(t('account.lockedUntil', { date: '' }).slice(0, 12)))
        expect(html).toContain(lng === 'es' ? '30 días' : '30 days')
        expect(html).toContain(esc(t('account.save')))
        expect(switchTag(html)).toContain('aria-checked="false"')
      })

      it('locked name: the field is disabled and says when it opens again', () => {
        const changedAt = Date.now() - 5 * DAY
        const html = render(user({ nameChangedAt: changedAt }))
        expect(html).not.toMatch(RAW_KEY)
        expect(isDisabled(nameInput(html))).toBe(true)
        expect(html).toContain(esc(t('account.lockedUntil', { date: longDate(lng, changedAt + NAME_LOCK_DAYS * DAY) })))
        // The country is still free: its hint is the up-front warning, not a date.
        expect(html).toContain(esc(t('account.lockHint', { days: COUNTRY_LOCK_DAYS })))
        expect(html.match(new RegExp(longDate(lng, changedAt + NAME_LOCK_DAYS * DAY), 'g'))).toHaveLength(1)
      })

      it('locked country: the country shows as a disabled value with the unlock date', () => {
        const changedAt = Date.now() - 29 * DAY
        const html = render(user({ countryChangedAt: changedAt }))
        expect(html).not.toMatch(RAW_KEY)
        expect(isDisabled(nameInput(html))).toBe(false)
        expect(html).toContain(esc(t('account.lockedUntil', { date: longDate(lng, changedAt + COUNTRY_LOCK_DAYS * DAY) })))
        expect(html).toMatch(/<input[^>]*disabled[^>]*readOnly[^>]*value="🇵🇪 [^"]+"/)
      })

      it('both locked: two dates, no editable field, nothing to confirm but the button stays off', () => {
        const nameAt = Date.now() - 1 * DAY
        const countryAt = Date.now() - 2 * DAY
        const html = render(user({ nameChangedAt: nameAt, countryChangedAt: countryAt }))
        expect(html).toContain(longDate(lng, nameAt + NAME_LOCK_DAYS * DAY))
        expect(html).toContain(longDate(lng, countryAt + COUNTRY_LOCK_DAYS * DAY))
        expect(html).not.toContain(esc(t('account.lockHint', { days: NAME_LOCK_DAYS })))
        expect(new RegExp(`<button[^>]*disabled[^>]*>${t('account.save')}</button>`).test(html)).toBe(true)
      })

      it('a lock that ended exactly 30 days ago is free again', () => {
        const html = render(user({ nameChangedAt: Date.now() - NAME_LOCK_DAYS * DAY - 1_000, countryChangedAt: Date.now() - COUNTRY_LOCK_DAYS * DAY - 1_000 }))
        expect(isDisabled(nameInput(html))).toBe(false)
        expect(html).not.toContain(esc(t('account.lockedUntil', { date: '' }).slice(0, 12)))
      })

      it('dev mode ignores the locks', () => {
        usePrefs.setState((s) => ({ dev: { ...s.dev, panelOpen: true } }))
        const html = render(user({ nameChangedAt: Date.now(), countryChangedAt: Date.now() }))
        expect(isDisabled(nameInput(html))).toBe(false)
        expect(html).not.toMatch(/<input[^>]*readOnly/)
      })

      it('anonymous on: the switch is checked, with its label and the friends hint', () => {
        const html = render(user({ anonymousRankings: true }))
        expect(html).not.toMatch(RAW_KEY)
        expect(switchTag(html)).toContain('aria-checked="true"')
        expect(html).toContain(esc(lng === 'es' ? 'Aparecer como «Entrenador anónimo» en los rankings global y de país' : 'Appear as “Anonymous trainer” on the global and country leaderboards'))
        expect(html).toContain(esc(lng === 'es' ? 'Tus amigos siguen viendo tu nombre.' : 'Your friends still see your name.'))
        expect(switchTag(html)).not.toMatch(/ data-disabled=/)
      })
    })
  }
})
