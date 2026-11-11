/** Render smoke test of the report body (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { createEngineContext, defaultContext, resolveContent, setDefaultContext, type AbilityDef } from '../../../engine'
import { makeMon, makePlayer, MIN, runSession, T0 } from '../../../engine/test-helpers'
import { SessionReport } from './SessionReport'

const ctx = defaultContext()

function sample() {
  const abilities: Record<string, AbilityDef> = { ...ctx.abilities, static: { ...ctx.abilities.static!, effects: [{ kind: 'statusOnAction', status: 'paralysis', chance: 1, limit: 1 }] } }
  const c = createEngineContext({ abilities })
  const team = [
    makeMon('gengar', 40, { uid: 'g', ability: 'cursed-body', equippedMoves: ['hypnosis', 'lick'], learnedMoves: ['hypnosis', 'lick'] }, c),
    makeMon('pikachu', 15, { uid: 'p', ability: 'static', equippedMoves: ['thunder-shock'], learnedMoves: ['thunder-shock'] }, c),
    makeMon('magnemite', 20, { uid: 'm', ability: 'magnet-pull' }, c),
  ]
  const player = makePlayer(team, {}, c)
  return { player, result: runSession(player, 50, 2, { startedAt: T0 + 11 * 60 * MIN }, c).result }
}

afterEach(() => setDefaultContext(null))

describe('SessionReport', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`renders every member and the wild factors (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const { player, result } = sample()
      const html = renderToStaticMarkup(<SessionReport result={result} player={player} />)
      expect(html).not.toMatch(/report\.[a-zA-Z]/) // no raw i18n keys
      expect(html.match(/<details/g)).toHaveLength(3)
      expect(html).toContain(i18n.t('report.wildsTitle'))
      expect(html).toContain('21:00')
      expect(html).toContain(lng === 'es' ? 'por acción' : 'per action')
      expect(html).toContain(lng === 'es' ? 'Parálisis' : 'Paralysis')
    })

    it(`shows how the points were calculated, adding up to the total (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const { player, result } = sample()
      const html = renderToStaticMarkup(<SessionReport result={result} player={player} />)
      expect(html).toContain(i18n.t('report.points.title'))
      expect(html).toContain(i18n.t('report.points.step.base'))
      expect(html).toContain(i18n.t('report.points.step.condition')) // 21:00 → Ghost condition
      expect(html).toContain(i18n.t('report.points.total'))
      expect(html).toContain(new Intl.NumberFormat(lng, { maximumFractionDigits: 0 }).format(result.totalPoints))
      // One team table plus one per member.
      expect(html.match(/<ol/g)?.length).toBe(1 + result.members.length)
    })

    it(`results saved before the breakdown say so instead of breaking (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const { player, result } = sample()
      const legacy = { ...result, members: result.members.map((m) => ({ ...m, pointsStages: undefined })) }
      const html = renderToStaticMarkup(<SessionReport result={legacy} player={player} />)
      expect(html).toContain(i18n.t('report.points.legacy'))
      expect(html).not.toMatch(/report\.points/)
    })

    it(`shows the event items that dropped, by name, and nothing when none did (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      setDefaultContext(createEngineContext(resolveContent({}, [], { 'golden-banana': { names: { es: 'Plátano dorado', en: 'Golden banana' } } })))
      const { player, result } = sample()
      const none = renderToStaticMarkup(<SessionReport result={result} player={player} />)
      expect(none).not.toContain(i18n.t('report.eventDrops.title'))
      const html = renderToStaticMarkup(<SessionReport result={{ ...result, eventItems: { 'golden-banana': 2 } }} player={player} />)
      expect(html).not.toMatch(/report\.eventDrops/)
      expect(html).toContain(i18n.t('report.eventDrops.title'))
      expect(html).toContain(lng === 'es' ? 'Plátano dorado' : 'Golden banana')
      expect(html).toContain('+2')
    })
  }
})
