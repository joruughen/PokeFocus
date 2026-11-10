import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { abilityOutlook, techniqueOutlook } from '../../engine'
import { makeMon } from '../../engine/test-helpers'
import { KindTip } from './KindTip'

const gengar = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis', 'lick'], learnedMoves: ['hypnosis', 'lick'] })
const swinub = makeMon('swinub', 30, { uid: 's', ability: 'snow-cloak' })

function html(kind: 'damage' | 'passive' | 'activable', outlook: Parameters<typeof KindTip>[0]['outlook']) {
  return renderToStaticMarkup(<KindTip kind={kind} outlook={outlook} pokemonName="Gengar" />)
}

describe('KindTip', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`activable: shows the Pokemon's own chance, rolls and what the charge does (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const o = techniqueOutlook(gengar, 'hypnosis')!
      const out = html('activable', o)
      expect(out).not.toMatch(/technique\.|tech\./)
      expect(out).toContain('Gengar')
      const pct = new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 1 }).format((o as { chancePerAction: number }).chancePerAction)
      expect(out).toContain(pct)
      expect(out).toContain(lng === 'es' ? 'Sueño' : 'Sleep')
    })

    it(`damage: explains what accumulating Energy is for, and the v0.9 counterattack (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const out = html('damage', techniqueOutlook(gengar, 'lick')!)
      expect(out).not.toMatch(/technique\.|tech\./)
      expect(out).toContain(lng === 'es' ? 'Para qué sirve' : 'What it is for')
      expect(out).toContain(lng === 'es' ? 'definitivo' : 'final attack')
      expect(out).toContain(lng === 'es' ? 'líder' : 'leader')
      expect(out).toContain(lng === 'es' ? 'dormido o paralizado' : 'asleep or paralyzed')
    })

    it(`passive: ability with a counterattack miss chance (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const out = html('passive', abilityOutlook(swinub))
      expect(out).not.toMatch(/technique\.|report\./)
      expect(out).toContain('25')
      expect(out).toContain(lng === 'es' ? 'Siempre activa' : 'Always on')
    })

    it(`without an outlook it is only the generic text (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const out = html('passive', null)
      expect(out).toContain(i18n.t('technique.kindHelp.passive'))
      expect(out).not.toContain('<ul')
    })
  }
})
