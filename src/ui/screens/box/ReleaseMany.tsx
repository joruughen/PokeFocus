/** Multi-release in the Box: the selection bar, the confirmation summary and the dialog that runs `releaseMany`. */
import { useTranslation } from 'react-i18next'
import type { PlayerState } from '../../../engine'
import { Button, Dialog, DialogClose, PixelIcon, Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'
import { HIGH_LEVEL_RELEASE, type ReleaseSummary } from './releaseSummary'

const SHOWN_NAMES = 4

export interface SelectionBarProps {
  count: number
  /** Selected Pokémon that the current filters hide. */
  hidden: number
  /** How many visible Pokémon can still be selected (0 disables "select visible"). */
  selectableVisible: number
  onSelectVisible: () => void
  onClear: () => void
  onRelease: () => void
  onCancel: () => void
}

/**
 * Sticky bar of the selection mode. On phones it sits just above the bottom navigation
 * (3.5rem + its 2px edge); from `sm` the navigation is a side rail, so it sticks to the bottom.
 */
export function SelectionBar({ count, hidden, selectableVisible, onSelectVisible, onClear, onRelease, onCancel }: SelectionBarProps) {
  const { t } = useTranslation()
  return (
    <div
      role="region"
      aria-label={t('box.select.bar')}
      className={cx('sticky z-20 flex flex-wrap items-center gap-x-4 gap-y-2 bg-dusk-700 p-3 shadow-plate', 'max-sm:bottom-[3.6rem] sm:bottom-3')}
    >
      <p className="mr-auto min-w-0 font-display text-lg" aria-live="polite">
        {t('box.select.count', { count })}
        {hidden > 0 && <span className="ml-2 text-base text-amber-400">({t('box.select.hidden', { count: hidden })})</span>}
      </p>
      {/* Phones: the count and "Cancel" share the first row, the actions get the second (the bar stays two rows tall, not four). */}
      <div className="flex items-center gap-2 max-sm:order-3 max-sm:w-full">
        <Button size="sm" variant="secondary" icon="plus" disabled={selectableVisible === 0} onClick={onSelectVisible} className="max-sm:flex-1">
          {t('box.select.visible')}
        </Button>
        <Button size="sm" variant="secondary" icon="minus" disabled={count === 0} onClick={onClear} aria-label={t('box.select.clear')} title={t('box.select.clear')}>
          <span className="max-sm:sr-only">{t('box.select.clear')}</span>
        </Button>
        <Button size="sm" variant="danger" icon="trash" disabled={count === 0} onClick={onRelease}>
          {t('box.select.release')}
        </Button>
      </div>
      <Button size="sm" variant="ghost" icon="close" onClick={onCancel} className="max-sm:order-2">
        {t('box.select.cancel')}
      </Button>
    </div>
  )
}

/** What the dialog shows: candies per line, then the highlighted warnings (each can drop its Pokémon from the selection). */
export function ReleaseSummaryBody({ summary, player, onKeep }: { summary: ReleaseSummary; player: PlayerState; onKeep?: (uids: string[]) => void }) {
  const { t } = useTranslation()
  const names = useNames()
  return (
    <div className="flex flex-col gap-4">
      {summary.warnings.length > 0 && (
        <section aria-label={t('box.select.warnTitle')} role="group" className="flex flex-col gap-2 bg-cheek-700/40 p-3 outline-2 -outline-offset-2 outline-cheek-400">
          <h3 className="flex items-center gap-2 font-display text-lg text-cheek-400">
            <PixelIcon name="help" size={16} />
            {t('box.select.warnTitle')}
          </h3>
          <ul className="flex flex-col gap-2">
            {summary.warnings.map((w) => {
              const shown = w.uids.slice(0, SHOWN_NAMES).map((uid) => (player.pokemon[uid] ? names.pokemonFull(player.pokemon[uid]) : uid))
              const extra = w.uids.length - shown.length
              return (
                <li key={w.kind} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0">
                    <strong className="font-display text-base text-mist-50">{t(`box.select.warn.${w.kind}`, { count: w.uids.length, level: HIGH_LEVEL_RELEASE })}</strong>
                    <span className="block text-sm text-mist-300">
                      {shown.join(', ')}
                      {extra > 0 && `, ${t('box.select.more', { count: extra })}`}
                    </span>
                  </span>
                  {onKeep && (
                    <Button size="sm" variant="secondary" onClick={() => onKeep(w.uids)}>
                      {t('box.select.keep')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section aria-label={t('box.select.gains')} className="bg-dusk-900 p-3 inset-shadow-well">
        <h3 className="mb-2 font-display text-base text-mist-300">{t('box.select.gains')}</h3>
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {summary.chains.map((c) => (
            <li key={c.chainId} className="flex items-center gap-3">
              <Sprite kind="icon" slug={c.rootSlug} scale={1} alt="" />
              <span className="min-w-0 flex-1 truncate font-display text-base">{names.species(c.rootSlug)}</span>
              <span className="text-sm text-mist-300">{t('box.select.gain', { count: c.count })}</span>
              <span className="flex w-14 items-center justify-end gap-1 font-num text-xl leading-none text-volt-300">
                <PixelIcon name="candy" size={16} />+{c.candies}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t-2 border-ink pt-2 text-right font-display text-lg text-volt-300">{t('box.select.total', { count: summary.totalCandies })}</p>
      </section>
    </div>
  )
}

export interface ReleaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: ReleaseSummary
  player: PlayerState
  busy: boolean
  onConfirm: () => void
  onKeep: (uids: string[]) => void
}

export function ReleaseDialog({ open, onOpenChange, summary, player, busy, onConfirm, onKeep }: ReleaseDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('box.select.dialogTitle', { count: summary.count })}
      description={t('box.select.dialogBody')}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
          <Button variant="danger" icon="trash" disabled={busy || summary.count === 0 || summary.blocked.length > 0} onClick={onConfirm}>
            {t('box.select.confirm', { count: summary.count })}
          </Button>
        </>
      }
    >
      <ReleaseSummaryBody summary={summary} player={player} onKeep={onKeep} />
    </Dialog>
  )
}
