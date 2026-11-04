import { useTranslation } from 'react-i18next'
import { defaultContext, type StatKey } from '../../engine'
import { cx } from '../lib/cx'
import { ArtIcon, type ArtIconName } from './ArtSvg'
import { Tooltip } from './Tooltip'

/** Art icon of each stat (public/art/stat-*.svg). */
export const STAT_ICON: Record<StatKey, ArtIconName> = {
  hp: 'stat-energy',
  speed: 'stat-pace',
  specialAttack: 'stat-output',
  attack: 'stat-catch',
  specialDefense: 'stat-technique',
  defense: 'stat-grit',
}

/** Display order of the six stats in PokeFocus. */
export const STAT_ORDER: StatKey[] = ['hp', 'speed', 'specialAttack', 'attack', 'specialDefense', 'defense']

export interface StatRowProps {
  stat: StatKey
  value: number
  /** Value at which the bar is full (default 200). */
  scale?: number
  /** Nature slug: shows ▲/▼ when it raises or lowers this stat. */
  nature?: string
  className?: string
}

/**
 * One stat with its PokeFocus name (never the original one, GDD §5.1) and a
 * help tooltip: what it does + "basada en Velocidad".
 * Labels: `stats.<key>.name`, `.what`, and `stats.<key>.base` for the original name.
 */
export function StatRow({ stat, value, scale = 200, nature, className }: StatRowProps) {
  const { t } = useTranslation()
  const n = nature ? defaultContext().naturesBySlug.get(nature) : undefined
  const mod = n?.increased === stat ? 'up' : n?.decreased === stat ? 'down' : null
  const f = Math.max(0.03, Math.min(1, value / scale))
  return (
    <div className={cx('grid grid-cols-[10.5rem_1fr_3rem] items-center gap-3', className)}>
      <Tooltip
        variant="help"
        side="left"
        content={
          <span className="flex flex-col gap-1">
            <span className="font-display text-base">{t(`stats.${stat}.name`)}</span>
            <span>{t(`stats.${stat}.what`)}</span>
            <span className="text-xs text-dusk-500">{t('stats.basedOn', { stat: t(`stats.${stat}.base`) })}</span>
          </span>
        }
      >
        <button type="button" className="flex items-center gap-1.5 text-left font-display text-base text-mist-100 underline decoration-dusk-500 decoration-dotted underline-offset-4 hover:text-volt-300">
          <ArtIcon name={STAT_ICON[stat]} size={24} className="text-volt-300" />
          {t(`stats.${stat}.name`)}
          {mod && (
            <span className={mod === 'up' ? 'text-leaf-400' : 'text-cheek-400'} aria-label={t(mod === 'up' ? 'stats.natureUp' : 'stats.natureDown')}>
              {mod === 'up' ? '▲' : '▼'}
            </span>
          )}
        </button>
      </Tooltip>
      <div className="h-2.5 bg-ink shadow-frame" aria-hidden>
        <div className="h-full bg-mist-300" style={{ width: `${f * 100}%` }} />
      </div>
      <span className="text-right font-num text-xl leading-none tabular">{Math.round(value)}</span>
    </div>
  )
}
