/** Render smoke tests of the Box multi-release UI (server-side render, ES and EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { MonTile } from '../../components'
import { useGame } from '../../store/game'
import { Box } from './Box'
import { ReleaseSummaryBody, SelectionBar } from './ReleaseMany'
import { releaseSummary } from './releaseSummary'

const mons = [
  makeMon('pidgey', 5, { uid: 't' }),
  makeMon('charmander', 5, { uid: 'a' }),
  makeMon('charmeleon', 20, { uid: 'b', nickname: 'Fuego' }),
  makeMon('squirtle', 30, { uid: 'c', isShiny: true }),
  makeMon('mewtwo', 10, { uid: 'd' }),
]
const player = { ...makePlayer([mons[0]!]), pokemon: Object.fromEntries(mons.map((m) => [m.uid, m])), teamPresets: [{ id: 't1', name: 'X', uids: ['a'] }] }

const noop = () => {}
const RAW_KEY = /box\.select\.|\{\{/

for (const lng of ['es', 'en'] as const) {
  describe(`multi-release UI (${lng})`, () => {
    it('selection bar: count, actions, disabled when nothing is selected', async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<SelectionBar count={0} hidden={0} selectableVisible={3} onSelectVisible={noop} onClear={noop} onRelease={noop} onCancel={noop} />)
      expect(html).toContain(i18n.t('box.select.count', { count: 0 }))
      for (const k of ['visible', 'clear', 'release', 'cancel']) expect(html).toContain(i18n.t(`box.select.${k}`))
      expect(html).toMatch(new RegExp(`<button[^>]* disabled=""[^>]*>[^]*?${i18n.t('box.select.release')}`))
      expect(html).not.toMatch(RAW_KEY)
      const some = renderToStaticMarkup(<SelectionBar count={4} hidden={2} selectableVisible={0} onSelectVisible={noop} onClear={noop} onRelease={noop} onCancel={noop} />)
      expect(some).toContain(i18n.t('box.select.count', { count: 4 }))
      expect(some).toContain(i18n.t('box.select.hidden', { count: 2 }))
      expect(some).not.toMatch(RAW_KEY)
    })

    it('summary: candies per line, total and every warning', async () => {
      await i18n.changeLanguage(lng)
      const summary = releaseSummary(player, ['a', 'b', 'c', 'd'])
      const html = renderToStaticMarkup(<ReleaseSummaryBody summary={summary} player={player} onKeep={noop} />)
      expect(html).toContain(i18n.t('box.select.total', { count: summary.totalCandies }))
      expect(html).toContain(i18n.t('box.select.warn.shiny', { count: 1 }))
      expect(html).toContain(i18n.t('box.select.warn.legendary', { count: 1 }))
      expect(html).toContain(i18n.t('box.select.warn.preset', { count: 1 }))
      expect(html).toContain(i18n.t('box.select.warn.nickname', { count: 1 }))
      expect(html).toContain(i18n.t('box.select.warn.highLevel', { count: 1, level: 30 }))
      expect(html).toContain('Fuego')
      expect(html).toContain('+3')
      expect(html).not.toMatch(RAW_KEY)
    })

    it('summary without warnings has no warning block', async () => {
      await i18n.changeLanguage(lng)
      const clean = { ...player, teamPresets: [] }
      const html = renderToStaticMarkup(<ReleaseSummaryBody summary={releaseSummary(clean, ['a'])} player={clean} />)
      expect(html).not.toContain(i18n.t('box.select.warnTitle'))
      expect(html).toContain(i18n.t('box.select.gains'))
    })

    it('tiles in selection mode are checkboxes; team members are locked with a reason', async () => {
      await i18n.changeLanguage(lng)
      const reason = i18n.t('box.select.inTeam')
      const escaped = reason.replace(/'/g, '&#x27;')
      const on = renderToStaticMarkup(<MonTile mon={mons[1]!} teamSlot={null} select={{ checked: true }} />)
      expect(on).toContain('role="checkbox"')
      expect(on).toContain('aria-checked="true"')
      expect(on).not.toContain('aria-disabled')
      const off = renderToStaticMarkup(<MonTile mon={mons[1]!} teamSlot={null} select={{ checked: false }} />)
      expect(off).toContain('aria-checked="false"')
      const locked = renderToStaticMarkup(<MonTile mon={mons[0]!} teamSlot={0} select={{ checked: false, blockedReason: reason }} />)
      expect(locked).toContain('aria-disabled="true"')
      expect(locked).toContain(`title="${escaped}"`)
      expect(locked).toContain(escaped)
      expect(renderToStaticMarkup(<MonTile mon={mons[1]!} teamSlot={null} />)).not.toContain('role="checkbox"')
    })

    it('the Box shows the Select button', async () => {
      await i18n.changeLanguage(lng)
      Object.assign(useGame.getInitialState(), { player })
      const html = renderToStaticMarkup(<Box />)
      expect(html).toContain(i18n.t('box.select.start'))
      expect(html).toContain('aria-pressed="false"')
      expect(html).not.toMatch(RAW_KEY)
    })
  })
}
