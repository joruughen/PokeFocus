import { useTranslation } from 'react-i18next'
import { getSpecies, getTechnique, type OwnedPokemon } from '../../engine'
import { cx } from '../lib/cx'
import { useNames } from '../lib/names'
import { useContent } from '../store/content'
import { Button } from './Button'
import { PixelIcon } from './PixelIcon'
import { Sprite } from './Sprite'
import { TYPE_BG, TypeBadge } from './TypeBadge'

export interface CopyPickerProps {
  /** Teammates that can be copied (see `copyCandidates` in the engine). */
  candidates: readonly OwnedPokemon[]
  /** Technique slots of the copier: how many of each teammate's equipped techniques it would use. */
  slots: number
  /** The teammate copied right now, if any: marked, and picking it again is allowed (it keeps the look). */
  currentUid?: string | null
  onPick: (target: string | 'random') => void
  /** Offers "go back to being <base species>" (stop copying). Omit when it is not copying. */
  onStop?: () => void
  /** Species the copier returns to on stop (default Ditto). */
  baseSlug?: string
  busy?: boolean
}

/**
 * Who to copy (Transformación): one game card per teammate with its types and the techniques
 * it would lend, plus a random pick. Content only (no Dialog), so it fits a Dialog or a screen.
 */
export function CopyPicker({ candidates, slots, currentUid, onPick, onStop, baseSlug = 'ditto', busy = false }: CopyPickerProps) {
  const { t } = useTranslation()
  const names = useNames()
  const ctx = useContent()

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={busy || candidates.length === 0}
        onClick={() => onPick('random')}
        className="flex items-center gap-3 bg-dusk-900 p-3 text-left inset-shadow-well enabled:hover:bg-dusk-700 disabled:opacity-60"
      >
        <span className="grid size-14 shrink-0 place-items-center bg-dusk-700 text-volt-300" aria-hidden>
          <PixelIcon name="help" size={30} />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-lg leading-tight text-mist-50">{t('transform.pick.random')}</span>
          <span className="block text-sm text-mist-300">{t('transform.pick.randomBody', { count: candidates.length })}</span>
        </span>
      </button>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('transform.pick.list')}>
        {candidates.map((c) => {
          const current = c.uid === currentUid
          const types = getSpecies(c.speciesSlug, ctx).types
          const moves = c.equippedMoves.slice(0, slots).flatMap((m) => {
            const info = getTechnique(m, ctx)
            return info ? [info] : []
          })
          const name = names.pokemon(c)
          return (
            <li key={c.uid} className="flex">
              <button
                type="button"
                disabled={busy}
                aria-pressed={current}
                onClick={() => onPick(c.uid)}
                className={cx(
                  'flex w-full min-w-0 items-start gap-3 bg-dusk-900 p-3 text-left inset-shadow-well enabled:hover:bg-dusk-700 disabled:opacity-60',
                  current && 'outline-3 outline-volt-400',
                )}
              >
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden bg-dusk-700">
                  <Sprite kind="icon" slug={c.speciesSlug} shiny={c.isShiny} scale={2} maxHeight={52} maxWidth={52} alt="" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 font-display text-lg leading-tight text-mist-50 [overflow-wrap:anywhere]">{name}</span>
                    <span className="shrink-0 font-num text-xl leading-none text-mist-100">
                      {t('pokemon.levelShort')}
                      {c.level}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {types.map((ty) => (
                      <TypeBadge key={ty} type={ty} />
                    ))}
                    {current && (
                      <span className="inline-flex h-6 items-center gap-1 bg-volt-400 px-1.5 font-display text-sm text-ink shadow-frame">
                        <PixelIcon name="check" size={10} />
                        {t('transform.pick.current')}
                      </span>
                    )}
                  </span>
                  {moves.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5" aria-label={t('transform.pick.movesAria', { name })}>
                      {moves.map((m) => (
                        <span key={m.slug} className="inline-flex items-center gap-1.5 bg-dusk-700 px-1.5 py-0.5 text-sm text-mist-100">
                          <span className={cx('size-2 shrink-0', TYPE_BG[m.type])} aria-hidden />
                          {names.move(m.slug)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-mist-400">{t('transform.pick.noMoves')}</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {onStop && (
        <div className="flex justify-end">
          <Button variant="secondary" icon="back" disabled={busy} onClick={onStop}>
            {t('transform.pick.stop', { name: names.species(baseSlug) })}
          </Button>
        </div>
      )}
    </div>
  )
}
