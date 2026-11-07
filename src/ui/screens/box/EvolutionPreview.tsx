import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IndividualCore } from '../../../engine'
import { ArtIcon, PixelIcon, STAT_ICON } from '../../components'
import { cx } from '../../lib/cx'
import { statChangeOnEvolution } from './evolutionStats'

/** `+7`, `−3` (a real minus sign) or `0`: a few evolutions (Caterpie → Metapod) do lower a stat. */
function fmtDelta(d: number): string {
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0'
}

/**
 * "Ver cambios de estadísticas" under an evolution option: the six stats as
 * `now → new (+N)` at the current level (engine `computeStats` through
 * `statChangeOnEvolution`; nothing is evolved). Collapsed by default so the
 * Evolution card stays short; the biggest gain is highlighted.
 */
export function EvolutionPreview({ pokemon, to, defaultOpen = false }: { pokemon: Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>; to: string; defaultOpen?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const change = statChangeOnEvolution(pokemon, to)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-sm text-mist-300 underline decoration-dusk-500 decoration-dotted underline-offset-4 hover:text-volt-300"
      >
        <PixelIcon name={open ? 'up' : 'down'} size={10} />
        {open ? t('evo.previewHide') : t('evo.previewShow')}
      </button>
      <div id={id} hidden={!open} className="mt-2">
        {open && (
          <>
            <p className="mb-1.5 font-display text-base text-mist-100">{t('evo.previewTitle')}</p>
            <ul className="flex flex-col gap-1">
              {change.changes.map((c) => {
                const best = c.stat === change.best
                const name = t(`stats.${c.stat}.name`)
                return (
                  <li
                    key={c.stat}
                    aria-label={t('evo.previewRow', { stat: name, from: c.from, to: c.to, delta: fmtDelta(c.delta) })}
                    className={cx('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-1.5 py-0.5 text-sm', best && 'bg-dusk-700 outline-2 outline-volt-400')}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-mist-100" aria-hidden>
                      <ArtIcon name={STAT_ICON[c.stat]} size={12} className="shrink-0 text-volt-300" />
                      <span className="truncate">{name}</span>
                      {best && <span className="shrink-0 bg-volt-400 px-1 font-display text-xs text-ink">{t('evo.previewBest')}</span>}
                    </span>
                    <span className="font-num text-lg leading-none tabular" aria-hidden>
                      {c.from} → {c.to}
                    </span>
                    <span className={cx('w-10 text-right font-num text-lg leading-none tabular', c.delta > 0 ? 'text-leaf-400' : c.delta < 0 ? 'text-cheek-400' : 'text-mist-400')} aria-hidden>
                      ({fmtDelta(c.delta)})
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-xs text-mist-400">{t('evo.previewNote', { level: pokemon.level })}</p>
          </>
        )}
      </div>
    </div>
  )
}
