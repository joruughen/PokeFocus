/** Pending captures (the Box was full, GDD §12.9): the window that settles them one by one, and the banner that reopens it. */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boxCapacity, defaultContext, type OwnedPokemon, type PendingChoice, type PlayerState } from '../../../engine'
import { Button, Dialog, IvQuality, PixelIcon, Segmented, Sprite, toast, TypeBadge } from '../../components'
import { HIGH_LEVEL_RELEASE, type ReleaseWarningKind } from './releaseSummary'
import { errorText } from '../../lib/errors'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useGame } from '../../store/game'
import { useBusy } from '../../store/selectors'
import { boxHasRoom, candyOf, isLegendarySlug, pendingOf, riskOf, swapCandidates, usePendingUi, type SwapSort } from './pendingCapture'
import { SHOWCASE_GAMMA } from '../../lib/spriteSize'

type Confirming = 'swap' | 'convert' | null

export interface PendingBodyProps {
  player: PlayerState
  capture: OwnedPokemon
  /** "1 of N" (omitted with a single capture). */
  position?: { index: number; total: number }
  busy: boolean
  /** "Decide later": close without changes. */
  onLater?: () => void
  /** Settle the capture; resolves to an error text, or null when it worked. */
  onResolve: (choice: PendingChoice) => Promise<string | null>
  /** Test hook: start with a row picked / a confirmation open. */
  initial?: { picked?: string; confirming?: Confirming }
}

/** Small tag (text, never colour alone) for what makes a Pokémon special. */
function Tag({ kind, children }: { kind: 'shiny' | 'legendary' | 'warn'; children: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center px-1.5 font-display text-sm leading-none shadow-frame',
        kind === 'shiny' && 'bg-shiny-300 text-ink',
        kind === 'legendary' && 'bg-cheek-500 text-mist-50',
        kind === 'warn' && 'bg-dusk-600 text-amber-400',
      )}
    >
      {children}
    </span>
  )
}

function MonTags({ mon, risks }: { mon: OwnedPokemon; risks: ReleaseWarningKind[] }) {
  const { t } = useTranslation()
  return (
    <>
      {mon.isShiny && <Tag kind="shiny">{`★ ${t('pokemon.shiny')}`}</Tag>}
      {risks.includes('legendary') && <Tag kind="legendary">{t('box.pending.legendary')}</Tag>}
      {risks.includes('nickname') && <Tag kind="warn">{t('box.pending.risk.nickname')}</Tag>}
      {risks.includes('highLevel') && <Tag kind="warn">{t('box.pending.risk.highLevelShort')}</Tag>}
      {risks.includes('preset') && <Tag kind="warn">{t('box.pending.risk.presetShort')}</Tag>}
    </>
  )
}

/** The capture waiting for a place: sprite, name, level, tags, types and IVs. */
function CaptureCard({ capture, risks }: { capture: OwnedPokemon; risks: ReleaseWarningKind[] }) {
  const { t } = useTranslation()
  const names = useNames()
  const sp = defaultContext().speciesBySlug.get(capture.speciesSlug)
  return (
    <section
      aria-label={t('box.pending.capture')}
      className={cx(
        'flex items-center gap-3 p-3 inset-shadow-well sm:gap-4 sm:p-4',
        capture.isShiny ? 'bg-dusk-900 outline-2 -outline-offset-2 outline-shiny-300' : 'bg-dusk-900',
      )}
    >
      <span className="grid h-24 w-24 shrink-0 place-items-center sm:h-28 sm:w-28">
        <Sprite kind="showdown" slug={capture.speciesSlug} shiny={capture.isShiny} box={{ height: 88, width: 88, gamma: SHOWCASE_GAMMA }} alt="" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="font-display text-sm text-mist-300">{t('box.pending.capture')}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 font-display text-2xl leading-tight break-words">
          {names.pokemon(capture)}
          <span className="font-num text-xl text-mist-300">
            {t('pokemon.levelShort')}
            {capture.level}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <MonTags mon={capture} risks={risks.filter((r) => r === 'legendary')} />
          {sp?.types.map((ty) => <TypeBadge key={ty} type={ty} />)}
        </div>
        <IvQuality ivs={capture.ivs} />
      </div>
    </section>
  )
}

function CandyChip({ gain }: { gain: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-num text-xl leading-none text-volt-300">
      <PixelIcon name="candy" size={16} />+{gain}
    </span>
  )
}

/** One Box Pokémon in the "release whom" list. */
function SwapRow({ mon, player, checked, onPick }: { mon: OwnedPokemon; player: PlayerState; checked: boolean; onPick: () => void }) {
  const { t } = useTranslation()
  const names = useNames()
  const risks = useMemo(() => riskOf(player, mon), [player, mon])
  const { gain } = candyOf(mon.speciesSlug)
  const risky = risks.length > 0
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={`${names.pokemonFull(mon)}, ${t('pokemon.levelShort')} ${mon.level}, ${t('box.pending.gain', { count: gain })}`}
        onClick={onPick}
        className={cx(
          'flex min-h-14 w-full items-center gap-3 px-2 py-1.5 text-left shadow-frame transition-colors duration-75',
          checked ? 'bg-dusk-600 outline-3 -outline-offset-3 outline-cheek-400' : 'bg-dusk-800 hover:bg-dusk-700',
          risky && !checked && 'bg-dusk-700/80',
        )}
      >
        <span className="grid size-11 shrink-0 place-items-center bg-dusk-900 inset-shadow-well">
          <Sprite kind="icon" slug={mon.speciesSlug} scale={1} alt="" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span title={names.pokemonFull(mon)} className="min-w-0 truncate font-display text-base leading-tight">
              {names.pokemon(mon)}
            </span>
            <span className="shrink-0 font-num text-lg leading-none text-mist-300">
              {t('pokemon.levelShort')}
              {mon.level}
            </span>
          </span>
          {risky && (
            <span className="flex flex-wrap gap-1">
              <MonTags mon={mon} risks={risks} />
            </span>
          )}
        </span>
        <CandyChip gain={gain} />
      </button>
    </li>
  )
}

/** Why a second confirmation: each flag in words (never only a colour). */
function RiskList({ risks }: { risks: ReleaseWarningKind[] }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-1">
      {risks.map((r) => (
        <li key={r} className="flex items-center gap-2 font-display text-base text-mist-50">
          <PixelIcon name="help" size={14} className="shrink-0 text-cheek-400" />
          {t(`box.pending.risk.${r}`, { level: HIGH_LEVEL_RELEASE })}
        </li>
      ))}
    </ul>
  )
}

/** The content of the window (presentational: `PendingCaptureDialog` wires it to the game). */
export function PendingCaptureBody({ player, capture, position, busy, onLater, onResolve, initial }: PendingBodyProps) {
  const { t } = useTranslation()
  const names = useNames()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SwapSort>('weakest')
  const [picked, setPicked] = useState<string | null>(initial?.picked ?? null)
  const [confirming, setConfirming] = useState<Confirming>(initial?.confirming ?? null)

  const room = boxHasRoom(player)
  const candidates = useMemo(() => swapCandidates(player, query, sort, names.lng), [player, query, sort, names.lng])
  const target = picked ? player.pokemon[picked] : undefined
  const captureRisks = useMemo(() => riskOf(player, capture), [player, capture])
  const targetRisks = useMemo(() => (target ? riskOf(player, target) : []), [player, target])
  const convert = candyOf(capture.speciesSlug)
  const lineName = names.species(convert.rootSlug)
  const gainOf = (mon: OwnedPokemon) => candyOf(mon.speciesSlug)
  const captureRisky = captureRisks.some((r) => r === 'shiny' || r === 'legendary')
  const total = Object.keys(player.pokemon).length

  const run = async (choice: PendingChoice) => {
    const err = await onResolve(choice)
    if (err) {
      toast.add({ title: err, type: 'danger' })
      setConfirming(null)
    }
  }
  const onSwap = () => {
    if (!target) return
    if (targetRisks.length > 0 && confirming !== 'swap') return setConfirming('swap')
    void run({ kind: 'swap', releaseUid: target.uid })
  }
  const onConvert = () => {
    if (captureRisky && confirming !== 'convert') return setConfirming('convert')
    void run({ kind: 'convert' })
  }

  const later = (
    <Button variant="ghost" onClick={onLater}>
      {t('box.pending.later')}
    </Button>
  )

  // ---- Extra confirmation (shiny, legendary, high level, nickname, saved team) ----
  if (confirming === 'swap' && target) {
    const g = gainOf(target)
    return (
      <div className="flex flex-col gap-4">
        <section role="group" aria-label={t('box.pending.confirmTitle')} className="flex flex-col gap-3 bg-cheek-700/40 p-4 outline-2 -outline-offset-2 outline-cheek-400">
          <h3 className="flex items-center gap-2 font-display text-xl text-cheek-400">
            <PixelIcon name="help" size={18} />
            {t('box.pending.confirmTitle')}
          </h3>
          <p>{t('box.pending.confirmSwap', { name: names.pokemonFull(target), capture: names.pokemon(capture), count: g.gain, line: names.species(g.rootSlug) })}</p>
          <RiskList risks={targetRisks} />
          <p className="text-sm text-mist-300">{t('box.pending.irreversible')}</p>
        </section>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            {t('box.pending.back')}
          </Button>
          <Button variant="danger" icon="trash" disabled={busy} onClick={() => void run({ kind: 'swap', releaseUid: target.uid })}>
            {t('box.pending.confirmSwapBtn', { name: names.pokemon(target) })}
          </Button>
        </div>
      </div>
    )
  }
  if (confirming === 'convert') {
    return (
      <div className="flex flex-col gap-4">
        <CaptureCard capture={capture} risks={captureRisks} />
        <section role="group" aria-label={t('box.pending.confirmTitle')} className="flex flex-col gap-3 bg-cheek-700/40 p-4 outline-2 -outline-offset-2 outline-cheek-400">
          <h3 className="flex items-center gap-2 font-display text-xl text-cheek-400">
            <PixelIcon name="help" size={18} />
            {t('box.pending.confirmTitle')}
          </h3>
          <p>{t('box.pending.confirmConvert', { name: names.pokemon(capture), count: convert.gain, line: lineName })}</p>
          <RiskList risks={captureRisks.filter((r) => r === 'shiny' || r === 'legendary')} />
          <p className="text-sm text-mist-300">{t('box.pending.irreversible')}</p>
        </section>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            {t('box.pending.back')}
          </Button>
          <Button variant="danger" icon="candy" disabled={busy} onClick={() => void run({ kind: 'convert' })}>
            {t('box.pending.confirmConvertBtn')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {position && position.total > 1 && (
        <p className="font-display text-lg text-volt-300" aria-live="polite">
          {t('box.pending.position', { index: position.index, total: position.total })}
        </p>
      )}
      <CaptureCard capture={capture} risks={captureRisks} />

      {room ? (
        <section aria-label={t('box.pending.keepTitle')} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-dusk-700 p-3 shadow-frame">
          <p className="min-w-0 flex-1 text-mist-100">{t('box.pending.keepBody', { count: total, max: boxCapacity(player.trainer.level) })}</p>
          <Button icon="box" disabled={busy} onClick={() => void run({ kind: 'keep' })}>
            {t('box.pending.keep')}
          </Button>
        </section>
      ) : (
        <p className="text-sm text-amber-400">{t('box.pending.fullNote', { count: total, max: boxCapacity(player.trainer.level) })}</p>
      )}

      <section aria-label={t('box.pending.swapTitle')} className="flex flex-col gap-3">
        <h3 className="font-display text-xl">{t('box.pending.swapTitle')}</h3>
        <p className="text-sm text-mist-300">{t('box.pending.swapHelp')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1.5 max-sm:basis-full">
            <span className="sr-only">{t('box.search')}</span>
            <span className="flex min-h-11 items-center gap-2 bg-dusk-900 px-3 shadow-frame inset-shadow-well focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-volt-400">
              <PixelIcon name="search" size={20} className="text-mist-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('box.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-mist-50 outline-none placeholder:text-mist-400"
              />
            </span>
          </label>
          <Segmented<SwapSort>
            label={t('box.sort.label')}
            value={sort}
            onChange={setSort}
            options={[
              { value: 'weakest', label: t('box.pending.sort.weakest') },
              { value: 'recent', label: t('box.pending.sort.recent') },
              { value: 'species', label: t('box.pending.sort.species') },
            ]}
          />
        </div>
        {candidates.length > 0 ? (
          <ul role="radiogroup" aria-label={t('box.pending.listLabel', { count: candidates.length })} className="flex max-h-72 flex-col gap-1.5 overflow-y-auto bg-dusk-900 p-1.5 inset-shadow-well">
            {candidates.map((m) => (
              <SwapRow key={m.uid} mon={m} player={player} checked={picked === m.uid} onPick={() => setPicked(m.uid)} />
            ))}
          </ul>
        ) : (
          <p className="bg-dusk-900 p-4 text-center text-mist-300 inset-shadow-well">{t('box.pending.noCandidates')}</p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 flex-1 text-sm text-mist-300" aria-live="polite">
            {target ? t('box.pending.swapPreview', { name: names.pokemon(target), capture: names.pokemon(capture), count: gainOf(target).gain }) : t('box.pending.pickOne')}
          </p>
          <Button variant="primary" icon="trash" disabled={busy || !target} onClick={onSwap}>
            {t('box.pending.swap')}
          </Button>
        </div>
      </section>

      <section aria-label={t('box.pending.convertTitle')} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-dusk-700 p-3 shadow-frame">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl">{t('box.pending.convertTitle')}</h3>
          <p className="text-sm text-mist-300">{t('box.pending.convertBody', { count: convert.gain, line: lineName })}</p>
        </div>
        <Button variant="secondary" icon="candy" disabled={busy} onClick={onConvert}>
          {t('box.pending.convert', { count: convert.gain })}
        </Button>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 flex-1 text-sm text-mist-300">{t('box.pending.laterHelp')}</p>
        {later}
      </div>
    </div>
  )
}

/**
 * The window of pending captures. Mount once in the app shell; open it with `usePendingUi.getState().setOpen(true)`.
 * Captures are settled one by one (the oldest first); it closes when none is left.
 */
export function PendingCaptureDialog() {
  const { t } = useTranslation()
  const names = useNames()
  const open = usePendingUi((s) => s.open)
  const setOpen = usePendingUi((s) => s.setOpen)
  const player = useGame((s) => s.player)
  const resolveCapture = useGame((s) => s.resolveCapture)
  const busy = useBusy()
  const list = player ? pendingOf(player) : []
  const first = list[0]
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (open) setTotal((n) => Math.max(n, list.length))
    else setTotal(0)
  }, [open, list.length])
  useEffect(() => {
    if (open && !first) setOpen(false)
  }, [open, first, setOpen])

  if (!player || !first) return null
  const shownTotal = Math.max(total, list.length)
  const onResolve = async (choice: PendingChoice): Promise<string | null> => {
    const err = await resolveCapture(first.uid, choice)
    if (err) return errorText(err, 'box')
    sfx(choice.kind === 'swap' ? 'flee' : 'catchSuccess')
    const name = names.pokemon(first)
    toast.add({ title: t(`box.pending.done.${choice.kind}`, { name, count: candyOf(first.speciesSlug).gain }), type: 'success' })
    return null
  }
  return (
    <Dialog open={open} onOpenChange={setOpen} size="lg" title={t('box.pending.title')} description={t('box.pending.intro')}>
      <PendingCaptureBody
        key={first.uid}
        player={player}
        capture={first}
        position={{ index: shownTotal - list.length + 1, total: shownTotal }}
        busy={busy}
        onLater={() => setOpen(false)}
        onResolve={onResolve}
      />
    </Dialog>
  )
}

/** "You have N pending captures" strip with a Decide button. Renders nothing when none are pending. */
export function PendingBanner({ className }: { className?: string }) {
  const { t } = useTranslation()
  const player = useGame((s) => s.player)
  const count = player ? pendingOf(player).length : 0
  if (count === 0 || !player) return null
  const special = pendingOf(player).some((p) => p.isShiny || isLegendarySlug(p.speciesSlug))
  return (
    <aside role="status" className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 bg-dusk-700 p-3 shadow-frame outline-2 -outline-offset-2 outline-amber-400', className)}>
      <PixelIcon name="box" size={24} className="shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-display text-lg leading-tight">{t('box.pending.banner', { count })}</p>
        <p className="text-sm text-mist-300">{special ? t('box.pending.bannerSpecial') : t('box.pending.bannerBody')}</p>
      </div>
      <Button size="sm" onClick={() => usePendingUi.getState().setOpen(true)}>
        {t('box.pending.decide')}
      </Button>
    </aside>
  )
}
