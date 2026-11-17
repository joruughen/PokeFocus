/**
 * Render test of one leaderboard row (server-side render, no DOM): a trainer
 * who chose to be anonymous, a normal one, and my own row when I am anonymous
 * ("Hidden from others"), in Spanish and English with no raw i18n keys.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import type { LeaderboardRow, LeaderboardScope } from '../../../game/protocol'
import { countryName } from '../../lib/countries'
import { LeaderRow } from './Leaderboards'

function row(patch: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return { rank: 4, userId: 'u4', trainerName: 'Misty', anonymous: false, country: 'PE', points: 1200, league: 'base', sub: 1, leader: 'pikachu', me: false, ...patch }
}

function render(r: LeaderboardRow, scope?: LeaderboardScope): string {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <LeaderRow row={r} scope={scope} />
      </tbody>
    </table>,
  )
}

const RAW_KEY = /\bleaderboard\.[a-zA-Z]/

describe('LeaderRow: anonymous trainers', () => {
  for (const lng of ['es', 'en'] as const) {
    const anonymous = lng === 'es' ? 'Entrenador anónimo' : 'Anonymous trainer'
    const hidden = lng === 'es' ? 'Oculto para los demás' : 'Hidden from others'

    describe(lng, () => {
      it('a null name reads "Anonymous trainer", muted, and keeps the flag and the country', async () => {
        await i18n.changeLanguage(lng)
        const html = render(row({ trainerName: null, anonymous: true }))
        expect(html).not.toMatch(RAW_KEY)
        expect(html).toContain(`<span class="text-mist-400">${anonymous}</span>`)
        expect(html).toContain('🇵🇪')
        expect(html).toContain(countryName('PE', lng)) // the country line under the name
        expect(html).not.toContain('null')
        expect(html).not.toContain(hidden) // the tag is for my own row only
        expect(html).not.toContain('aria-current')
      })

      it('a named trainer shows the name and no anonymous label', async () => {
        await i18n.changeLanguage(lng)
        const html = render(row())
        expect(html).toContain('Misty')
        expect(html).not.toContain(anonymous)
        expect(html).not.toContain(hidden)
      })

      it('my anonymous row shows my real name, "you" and the "Hidden from others" tag', async () => {
        await i18n.changeLanguage(lng)
        const html = render(row({ trainerName: 'Ash', anonymous: true, me: true }), 'global')
        expect(html).not.toMatch(RAW_KEY)
        expect(html).toContain('Ash')
        expect(html).toContain(lng === 'es' ? '(tú)' : '(you)')
        expect(html).toContain(hidden)
        expect(html).toContain('aria-current="true"')
        expect(html).not.toContain(anonymous)
        // Same in the country scope.
        expect(render(row({ trainerName: 'Ash', anonymous: true, me: true }), 'country')).toContain(hidden)
      })

      it('the tag is not shown in the friends scope (friends see my name) nor when I am not anonymous', async () => {
        await i18n.changeLanguage(lng)
        expect(render(row({ trainerName: 'Ash', anonymous: true, me: true }), 'friends')).not.toContain(hidden)
        expect(render(row({ trainerName: 'Ash', anonymous: false, me: true }), 'global')).not.toContain(hidden)
      })
    })
  }
})
