/** Player-support UI: permission rules, and server-side renders of the search, sheet and grant form (ES + EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import type { AdminPlayerDetail, UserRole } from '../../../../game/protocol'
import { playersErrorText } from './errors'
import { GrantForm } from './GrantForm'
import { PlayerDetailView } from './PlayerDetail'
import { PlayersSearchView } from './PlayersPanel'
import { isStaff, playerPermissions } from './permissions'

const noop = () => undefined
const RAW_KEY = /\badmin\.players\./
const DAY = 86_400_000

describe('playerPermissions', () => {
  const who = (role: UserRole, id = 't') => ({ id, role })
  it('support moderates players only; admin moderates anyone; only admin grants', () => {
    expect(playerPermissions({ id: 'm', role: 'support' }, who('player'))).toEqual({ moderate: true, grant: false, logoutAll: true })
    expect(playerPermissions({ id: 'm', role: 'support' }, who('support'))).toEqual({ moderate: false, grant: false, logoutAll: false })
    expect(playerPermissions({ id: 'm', role: 'support' }, who('admin'))).toEqual({ moderate: false, grant: false, logoutAll: false })
    expect(playerPermissions({ id: 'm', role: 'admin' }, who('admin'))).toEqual({ moderate: true, grant: true, logoutAll: true })
  })
  it('nobody signs themselves out; players get nothing', () => {
    expect(playerPermissions({ id: 'm', role: 'admin' }, who('admin', 'm')).logoutAll).toBe(false)
    expect(playerPermissions({ id: 'm', role: 'player' }, who('player'))).toEqual({ moderate: false, grant: false, logoutAll: false })
    expect([isStaff('player'), isStaff('support'), isStaff('admin'), isStaff(undefined)]).toEqual([false, true, true, false])
  })
})

function detail(patch: Partial<AdminPlayerDetail['user']> = {}, withSession = true): AdminPlayerDetail {
  const now = Date.UTC(2026, 10, 9)
  return {
    user: { id: 't', email: 'ash@example.com', trainerName: 'Ash', country: 'PE', friendCode: 'ABCD2345', role: 'player', createdAt: now - 40 * DAY, anonymousRankings: false, nameUnlockAt: now + 3 * DAY, countryUnlockAt: null, ...patch },
    doc: {
      version: 4,
      updatedAt: now,
      hasPlayer: true,
      trainerLevel: 7,
      dust: 321,
      inventory: { 'poke-ball': 5, potion: 0 },
      pokemonCount: 3,
      team: [{ uid: 'p1', speciesSlug: 'squirtle', level: 12, shiny: false, nickname: 'Shelly' }],
      timezone: 'America/Lima',
      timezoneUnlockAt: now + DAY,
      activeSession: withSession ? { id: 's1', startedAt: now - 600_000, plannedMinutes: 25, endsAt: now + 900_000, paused: false } : null,
      history: [{ id: 'h1', claimedAt: now - DAY, minutes: 25, points: 120, focus: 0.9, lateClaim: true }],
    },
    authSessions: [{ id: 'a1', createdAt: now, lastSeenAt: now, userAgent: 'Firefox' }],
    serverNow: now,
  }
}

const sheet = (d: AdminPlayerDetail, role: UserRole) =>
  renderToStaticMarkup(<PlayerDetailView detail={d} me={{ id: 'me', role }} busy={false} onUnlock={noop} onCancelSession={noop} onLogoutAll={noop} grant={<p>GRANT-FORM</p>} />)

describe('player sheet', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`admin sees every action and the grant form (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = sheet(detail(), 'admin')
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('ash@example.com')
      expect(html).toContain('ABCD2345')
      expect(html).toContain('Shelly')
      expect(html).toContain('GRANT-FORM')
      expect(html).toContain(i18n.t('admin.players.cancelSession'))
      expect(html).toContain(i18n.t('admin.players.logoutAll'))
      // Name and time zone are locked (two unlock buttons); country is free.
      expect(html.split(`>${i18n.t('admin.players.unlock')}<`).length - 1).toBe(2)
      expect(html).toContain(i18n.t('admin.players.free'))
    })

    it(`support on a player: no grant form; on staff: no actions at all (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const onPlayer = sheet(detail(), 'support')
      expect(onPlayer).not.toContain('GRANT-FORM')
      expect(onPlayer).toContain(i18n.t('admin.players.cancelSession'))
      const onStaff = sheet(detail({ role: 'support' }), 'support')
      expect(onStaff).not.toMatch(RAW_KEY)
      for (const k of ['cancelSession', 'logoutAll', 'unlock']) expect(onStaff).not.toContain(`>${i18n.t(`admin.players.${k}`)}<`)
    })
  }

  it('an account without a starter or session shows the empty states', async () => {
    await i18n.changeLanguage('en')
    const d = detail({}, false)
    expect(sheet(d, 'admin')).toContain(i18n.t('admin.players.noSession'))
    d.doc = { ...d.doc!, hasPlayer: false }
    const html = sheet(d, 'admin')
    expect(html).toContain(i18n.t('admin.players.noPlayer'))
    expect(html).not.toContain('GRANT-FORM')
  })
})

describe('search view and grant form', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`search results, empty result and error (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const base = { query: 'ash', onQuery: noop, onSearch: noop, searching: false, selectedId: 't', onSelect: noop, error: null }
      const found = renderToStaticMarkup(<PlayersSearchView {...base} results={[{ id: 't', email: 'ash@example.com', trainerName: 'Ash', country: 'PE', friendCode: 'ABCD2345', role: 'support', createdAt: 0 }]} />)
      expect(found).not.toMatch(RAW_KEY)
      expect(found).toContain('Ash')
      expect(found).toContain(i18n.t('admin.players.roles.support'))
      expect(renderToStaticMarkup(<PlayersSearchView {...base} results={[]} />)).toContain(i18n.t('admin.players.noResults'))
      expect(renderToStaticMarkup(<PlayersSearchView {...base} results={null} error="boom" />)).toContain('boom')
      // Too short a query keeps the button disabled.
      expect(renderToStaticMarkup(<PlayersSearchView {...base} query="a" results={null} />)).toMatch(/<button[^>]*disabled/)
    })

    it(`grant form asks for the password only when not elevated (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const props = { onGrant: async () => undefined, onReauth: async () => undefined }
      const cold = renderToStaticMarkup(<GrantForm {...props} elevated={false} />)
      const warm = renderToStaticMarkup(<GrantForm {...props} elevated error="nope" />)
      expect(cold).not.toMatch(RAW_KEY)
      expect(cold).toContain(i18n.t('admin.players.grant.password'))
      expect(warm).not.toContain(i18n.t('admin.players.grant.password'))
      expect(warm).toContain('nope')
      expect(warm).toContain(i18n.t('admin.players.grant.reason'))
    })
  }

  it('every server error code has copy in both languages', async () => {
    const { ApiError } = await import('../../../api')
    for (const lng of ['es', 'en']) {
      await i18n.changeLanguage(lng)
      for (const code of ['invalid_query', 'forbidden', 'forbidden_target', 'elevation_required', 'wrong_password', 'not_found', 'no_session', 'not_locked', 'no_player', 'self_target', 'empty_grant', 'unknown_item', 'invalid_amount', 'amount_too_large', 'too_many_items', 'invalid_body']) {
        expect(playersErrorText(new ApiError(409, code)), code).not.toMatch(/admin\.players|errors\.api/)
      }
      expect(playersErrorText(new ApiError(429, 'rate_limited', 120))).toMatch(/2/)
      expect(playersErrorText(new Error('x'))).not.toMatch(/admin\.players/)
    }
  })
})
