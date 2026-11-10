import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { catchBreakdown, defaultContext, type WildPokemon } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { CatchTip, rateWord } from './CatchTip'

function wild(slug: string, patch: Partial<WildPokemon> = {}): WildPokemon {
  return {
    uid: 'w',
    speciesSlug: slug,
    level: 3,
    isShiny: false,
    isLegendary: false,
    hpFraction: 0.01,
    status: null,
    studyBallEligible: false,
    guaranteedBall: null,
    failedThrows: 0,
    nextThrowBonus: 1,
    outcome: 'pending',
    ...patch,
  } as WildPokemon
}

const player = makePlayer([makeMon('bulbasaur', 10)])

describe('CatchTip', () => {
  it('rate words', () => {
    expect(rateWord(45)).toBe('veryHard')
    expect(rateWord(90)).toBe('hard')
    expect(rateWord(120)).toBe('normal')
    expect(rateWord(255)).toBe('easy')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`Squirtle with a Great Ball: the low capture rate, HP at the floor and what would raise it (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const b = catchBreakdown(player, wild('squirtle'), 'great-ball', defaultContext())
      const out = renderToStaticMarkup(<CatchTip b={b} ball="great-ball" speciesSlug="squirtle" />)
      expect(out).not.toMatch(/waves\.|catchTip\./)
      expect(out).toContain('45/255')
      expect(out).toContain('×1.5'.replace('.', lng === 'es' ? ',' : '.'))
      expect(out).toContain(new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 0 }).format(b.ifAsleep!))
      expect(out).toContain(lng === 'es' ? 'clima' : 'weather')
    })

    it(`guaranteed throws say so in one line (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const b = catchBreakdown(player, wild('pidgey', { studyBallEligible: true }), 'study-ball', defaultContext())
      const out = renderToStaticMarkup(<CatchTip b={b} ball="study-ball" speciesSlug="pidgey" />)
      expect(out).not.toMatch(/waves\.|catchTip\./)
      expect(out).not.toContain('255')
    })
  }
})
