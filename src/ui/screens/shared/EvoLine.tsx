import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, type Evolution, type Species } from '../../../engine'
import { PixelIcon, Sprite, Tooltip } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'
import { useContent } from '../../store/content'

/** Root of the evolution line (inside the pack). */
export function lineRoot(sp: Species): Species {
  const ctx = defaultContext()
  let cur = sp
  for (let i = 0; i < 4 && cur.evolvesFrom !== null; i++) {
    const prev = ctx.speciesById.get(cur.evolvesFrom)
    if (!prev) break
    cur = prev
  }
  return cur
}

/** Short condition text for one evolution edge ("Nv 16", "Piedra Fuego", "Vínculo, de día"). */
export function useEvoCondition() {
  const { t } = useTranslation()
  const names = useNames()
  return (e: Evolution): string => {
    switch (e.trigger) {
      case 'level':
        return t('evo.cond.level', { level: e.minLevel ?? 1 })
      case 'item':
        return e.item ? names.item(e.item) : t('evo.cond.item')
      case 'friendship':
        return e.timeOfDay === 'day' ? t('evo.cond.bondDay') : e.timeOfDay ? t('evo.cond.bondNight') : t('evo.cond.bond')
      case 'trade':
        return t('evo.cond.trade')
      default:
        return t('evo.cond.other')
    }
  }
}

type Known = 'caught' | 'seen' | 'unknown'

/**
 * The whole evolution line as box icons with the condition on each arrow.
 * Branches (Eevee) stack vertically. `known` hides species the player hasn't seen.
 */
export function EvoLine({ slug, known, onPick, className }: { slug: string; known?: (slug: string) => Known; onPick?: (slug: string) => void; className?: string }) {
  const ctx = useContent()
  const names = useNames()
  const { t } = useTranslation()
  const cond = useEvoCondition()
  const sp = ctx.speciesBySlug.get(slug)
  if (!sp) return null
  const root = lineRoot(sp)

  const node = (s: Species) => {
    const k = known ? known(s.slug) : 'caught'
    const label = k === 'unknown' ? t('dex.unknownName') : names.species(s.slug)
    const inner = (
      <span className={cx('flex w-20 flex-col items-center gap-1 p-1 text-center', s.slug === slug && 'bg-dusk-700 shadow-frame')}>
        <span className="grid h-12 place-items-center">
          <Sprite kind="icon" slug={s.slug} scale={2} alt="" className={cx(k === 'unknown' && 'brightness-0 opacity-60', k === 'seen' && 'opacity-60 grayscale-[.6]')} />
        </span>
        <span className="w-full truncate text-xs text-mist-100">{label}</span>
      </span>
    )
    return onPick && k !== 'unknown' ? (
      <button type="button" onClick={() => onPick(s.slug)} aria-current={s.slug === slug ? 'true' : undefined} className="hover:bg-dusk-700">
        {inner}
      </button>
    ) : (
      inner
    )
  }

  const branch = (s: Species): React.ReactNode => {
    const kids = s.evolutions.map((e) => ({ e, to: ctx.speciesById.get(e.to) })).filter((k): k is { e: Evolution; to: Species } => Boolean(k.to))
    return (
      <div className="flex items-center gap-1">
        {node(s)}
        {kids.length > 0 && (
          <div className="flex flex-col gap-2">
            {kids.map(({ e, to }) => (
              <Fragment key={to.slug}>
                <div className="flex items-center gap-1">
                  <Tooltip content={cond(e)}>
                    <span tabIndex={0} className="flex w-20 flex-col items-center text-center text-xs leading-tight text-mist-300">
                      <PixelIcon name="next" size={10} className="text-volt-400" />
                      <span className="line-clamp-2">{cond(e)}</span>
                    </span>
                  </Tooltip>
                  {branch(to)}
                </div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (root.evolutions.length === 0) return <p className={cx('text-sm text-mist-300', className)}>{t('evo.none', { name: names.species(slug) })}</p>
  return <div className={cx('overflow-x-auto pb-1', className)}>{branch(root)}</div>
}
