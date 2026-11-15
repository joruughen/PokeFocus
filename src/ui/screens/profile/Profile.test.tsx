/** Render smoke test of the Profile screen (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext, trainerExpForLevel, type PlayerState, type SessionSummary } from '../../../engine'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import type { PublicUser } from '../../../game/protocol'
import { useAuth } from '../../store/auth'
import { useGame } from '../../store/game'
import Profile, { fmtStudy } from './Profile'

const ctx = defaultContext()
const cfg = ctx.config.trainer

function session(i: number): SessionSummary {
  return {
    id: `s${i}`, startedAt: T0 - i * 86_400_000, endedAt: T0, claimedAt: T0, dayKey: '2026-11-03', weekKey: '2026-11-02', minutes: 25, pausedSeconds: 0, focus: 0.9, screenshotLabels: null,
    lateClaim: false, rewardFactor: 1, points: 10, exp: 5, dust: 20, pokeBalls: 1, conditions: [], soundProfile: null, wilds: 4, caught: 1, techniqueActivations: 0, note: null, subjectTag: null,
  }
}

function load(patch: Partial<PlayerState> = {}, user: Partial<PublicUser> | null = null) {
  const player = makePlayer([makeMon('pikachu', 10, { uid: 'm', nickname: 'Rayito' })], { pokedex: { caught: ['pikachu'], seen: ['pikachu', 'eevee'] }, ...patch })
  Object.assign(useGame.getInitialState(), { player })
  const u = user ? ({ id: 'u', email: 'a@b.c', trainerName: 'Ash', country: 'PE', friendCode: 'ABCDEFGH', createdAt: T0, nameChangedAt: null, countryChangedAt: null, anonymousRankings: false, role: 'player', ...user } as PublicUser) : null
  Object.assign(useAuth.getInitialState(), { user: u, status: u ? 'authed' : 'anon' })
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'")

afterEach(() => {
  Object.assign(useAuth.getInitialState(), { user: null, status: 'anon' })
})

describe('Profile screen', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`renders every section of a new trainer without raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load()
      const html = renderToStaticMarkup(<Profile />)
      const plain = text(html)
      expect(plain).not.toMatch(/\b(profile|nav|dev|trainer|league|items)\.[a-zA-Z]+/)
      expect(html).toContain(lng === 'es' ? 'Perfil' : 'Profile')
      expect(html).toContain(i18n.t('profile.level.title'))
      expect(html).toContain(i18n.t('profile.streak.title'))
      expect(html).toContain(i18n.t('profile.unlocks.title'))
      expect(html).toContain(i18n.t('profile.stats.title'))
      // the partner and the nickname
      expect(html).toContain('Rayito')
      // the "?" with how EXP is earned, and the empty-state invitation
      expect(html).toContain(`aria-label="${i18n.t('profile.level.howAria')}"`)
      expect(plain).toContain(i18n.t('profile.stats.empty.title'))
      expect(plain).toContain(i18n.t('profile.streak.state.none'))
    })

    it(`shows what is missing for the next level, with study time (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const exp = trainerExpForLevel(3, ctx) + 20
      load({ trainer: { level: 3, exp } })
      const plain = text(renderToStaticMarkup(<Profile />))
      const missing = trainerExpForLevel(4, ctx) - exp
      expect(plain).toContain(i18n.t('profile.level.missing', { count: missing, exp: String(missing), next: 4 }))
      expect(plain).toContain(i18n.t('profile.level.approx', { time: fmtStudy(Math.ceil(missing / cfg.expPerMinute), lng) }))
      expect(plain).toContain(i18n.t('profile.level.nextReward', { level: 4 }))
    })

    it(`the unlock ladder marks reached levels and lists the next ones (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load({ trainer: { level: ctx.config.advanced.mint.minTrainerLevel, exp: trainerExpForLevel(ctx.config.advanced.mint.minTrainerLevel, ctx) } })
      const html = renderToStaticMarkup(<Profile />)
      expect(html).toContain(i18n.t('profile.unlocks.kind.mint.name'))
      expect(html).toContain(i18n.t('profile.unlocks.kind.tera.name'))
      expect(html).toContain(i18n.t('profile.unlocks.unlocked'))
      expect(html).toContain('aria-current="step"')
    })

    it(`maximum level shows the end state instead of a bar (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load({ trainer: { level: cfg.maxLevel, exp: trainerExpForLevel(cfg.maxLevel, ctx) } })
      const plain = text(renderToStaticMarkup(<Profile />))
      expect(plain).toContain(i18n.t('profile.level.max'))
      expect(plain).toContain(i18n.t('profile.unlocks.allDone'))
    })

    it(`with sessions shows the totals and the weekly chart, with the account's country and anonymity (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load({ history: [session(0), session(1), session(2)] }, { anonymousRankings: true })
      const html = renderToStaticMarkup(<Profile />)
      const plain = text(html)
      expect(plain).not.toMatch(/\b(profile|nav|dev|trainer|league|items)\.[a-zA-Z]+/)
      expect(plain).toContain(i18n.t('profile.stats.hours'))
      expect(plain).toContain('1 h 15 min')
      expect(plain).not.toContain(i18n.t('profile.stats.empty.title'))
      expect(html).toContain(`aria-label="${i18n.t('profile.stats.weeksLabel', { count: 8 })}"`)
      expect(html).toContain('🇵🇪')
      expect(plain).toContain(i18n.t('profile.hero.anonymous'))
      expect(plain).toContain('Ash')
    })
  }

  it('formats study time in words', () => {
    expect(fmtStudy(45, 'en')).toBe('45 min')
    expect(fmtStudy(60, 'en')).toBe('1 h')
    expect(fmtStudy(80, 'en')).toBe('1 h 20 min')
  })
})
