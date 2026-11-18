import { useTranslation } from 'react-i18next'
import type { StudyCandyGrant } from '../../../engine'
import { PixelIcon, Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'

/**
 * Partner candies of the session (GDD §12.2): one chip per evolution line of the team, the leader's first and
 * highlighted. `done` = the day's partner candies were already paid by an earlier session (a one-line reminder).
 */
export function PartnerCandies({ grants, done, minMinutes, perDay }: { grants: readonly StudyCandyGrant[]; done: boolean; minMinutes: number; perDay: number }) {
  const { t } = useTranslation()
  const names = useNames()
  if (grants.length === 0 && !done) return null
  if (grants.length === 0) {
    return (
      <p className="mt-4 flex items-center gap-2 bg-dusk-900 p-3 text-sm text-mist-300 inset-shadow-well">
        <PixelIcon name="candy" size={16} className="shrink-0 text-exp-400" />
        {t('results.partnerCandiesDone', { min: minMinutes })}
      </p>
    )
  }
  const total = grants.reduce((a, g) => a + g.amount, 0)
  const sorted = [...grants].sort((a, b) => Number(b.leader) - Number(a.leader) || b.amount - a.amount)
  return (
    <div className="mt-4 bg-dusk-900 p-3 inset-shadow-well" data-testid="partner-candies">
      <p className="flex items-center gap-2 text-sm">
        <PixelIcon name="candy" size={16} className="shrink-0 text-exp-400" />
        <span className="flex-1">{t('results.partnerCandies')}</span>
        <span className="font-num text-xl leading-none tabular">+{total}</span>
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {sorted.map((g) => (
          <li
            key={g.chainId}
            className={cx('inline-flex items-center gap-1 bg-dusk-800 py-1 pl-1 pr-2 text-sm shadow-frame', g.leader && 'text-volt-400')}
            title={g.leader ? t('results.partnerCandiesLeader') : undefined}
          >
            <Sprite kind="icon" slug={g.speciesSlug} scale={1} alt="" />
            <span>{names.species(g.speciesSlug)}</span>
            <span className="font-num text-lg leading-none tabular">+{g.amount}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-mist-300">{t('results.partnerCandiesNote', { min: minMinutes, count: perDay })}</p>
    </div>
  )
}
