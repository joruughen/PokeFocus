import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TYPES, defaultContext, type TypeSlug } from '../../../engine'
import { Button, Dialog, Panel, PixelIcon, ProgressBar, RoleBadge, Select, Sprite, TypeBadge } from '../../components'
import { hintAnchor } from '../../hints'
import { conditionEnvNow } from '../../lib/conditions'
import { cx } from '../../lib/cx'
import { speciesName, typeName, useNames } from '../../lib/names'
import { useSessionWeather } from '../../lib/weather'
import { navigate } from '../../router'
import { usePlayer } from '../../store/selectors'
import { boxCandidates, boxSize, pickFiltersActive, pickRows, sortPickRows, swapInTeam, usePickFilters, type PickRow, type PickSort } from './pickFromBox'

/** Minutes of the hypothetical session behind the "if it studied now" multiplier (the first preset, like the team warnings). */
const PLANNED_MIN = defaultContext().config.session.presets[0] ?? 25

type Apply = (uids: string[], msg?: string) => Promise<void>

interface Props {
  /** Game minute (ms, floored to the minute): the energy and conditions refresh once per minute. */
  at: number
  /** Active session or a request in flight: nothing can be added or swapped. */
  disabled: boolean
  onApply: Apply
}

/**
 * "Add from the Box": search, type filter and sort over the Box members, each
 * row with its types and the condition multiplier it would get if it studied
 * now. With a full team the row's button opens a chooser to swap one member.
 */
function BoxPickerPanel({ at, disabled, onApply }: Props) {
  const { t } = useTranslation()
  const names = useNames()
  const lng = names.lng
  const player = usePlayer()
  const f = usePickFilters()
  const query = useDeferredValue(f.query)
  const weather = useSessionWeather(player.profile).effective
  const [swap, setSwap] = useState<{ uid: string; open: boolean } | null>(null)

  // The condition env is built once per minute (not per row).
  const env = useMemo(() => conditionEnvNow(player, at, PLANNED_MIN, weather), [player, at, weather])
  const candidates = useMemo(() => boxCandidates(player, { query, type: f.type }, lng), [player, query, f.type, lng])
  const rows = useMemo(() => sortPickRows(pickRows(player, candidates, at, env), f.sort), [player, candidates, at, env, f.sort])
  const total = useMemo(() => boxSize(player), [player])
  const filtered = pickFiltersActive({ query, type: f.type })
  const full = player.team.length >= 6

  const typeOptions = useMemo(() => [{ value: 'any', label: t('team.pick.anyType') }, ...ALL_TYPES.map((ty) => ({ value: ty, label: typeName(ty, lng) }))], [t, lng])
  const sortOptions = useMemo(
    () => (['now', 'level', 'energy', 'recent'] as const).map((value) => ({ value, label: t(`team.pick.sort.${value}`) })),
    [t],
  )

  const teamUids = player.team
  const mons = player.pokemon
  const onAction = useCallback(
    (uid: string) => {
      const mon = mons[uid]
      if (!mon) return
      if (teamUids.length >= 6) setSwap({ uid, open: true })
      else void onApply([...teamUids, uid], t('detail.added', { name: speciesName(mon.speciesSlug, lng) }))
    },
    [mons, teamUids, onApply, t, lng],
  )

  const incoming = swap ? mons[swap.uid] : undefined
  const members = useMemo(
    () => pickRows(player, teamUids.flatMap((u) => (player.pokemon[u] ? [player.pokemon[u]!] : [])), at, env),
    [player, teamUids, at, env],
  )
  const onSwap = (outUid: string) => {
    setSwap((s) => s && { ...s, open: false })
    if (!swap || !incoming) return
    const next = swapInTeam(teamUids, outUid, swap.uid)
    const out = mons[outUid]
    if (!next || !out) return
    const params = { in: names.species(incoming.speciesSlug), out: names.species(out.speciesSlug) }
    void onApply(next, t(teamUids.indexOf(outUid) === 0 ? 'team.swap.doneLeader' : 'team.swap.done', params))
  }

  return (
    <Panel title={t('team.fromBox')} {...hintAnchor('team.box')}>
      {total === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-mist-300">{t('team.boxEmpty')}</p>
          <Button size="sm" icon="play" onClick={() => navigate('home')}>
            {t('placeholder.cta')}
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-2 bg-dusk-900 px-3 shadow-frame inset-shadow-well focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-volt-400">
              <PixelIcon name="search" size={20} className="shrink-0 text-mist-400" />
              <span className="sr-only">{t('team.pick.search')}</span>
              <input
                type="search"
                value={f.query}
                onChange={(e) => f.set({ query: e.target.value })}
                placeholder={t('team.pick.search')}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-mist-50 outline-none placeholder:text-mist-400"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Select className="min-w-0" label={t('team.pick.type')} options={typeOptions} value={f.type} onChange={(v) => f.set({ type: v as TypeSlug | 'any' })} />
              <Select className="min-w-0" label={t('team.pick.sort.label')} options={sortOptions} value={f.sort} onChange={(v) => f.set({ sort: v as PickSort })} />
            </div>
            <div className="flex min-h-9 items-center justify-between gap-3">
              <p role="status" className="text-sm text-mist-300">
                {filtered ? t('team.pick.countFiltered', { shown: rows.length, total }) : t('team.pick.count', { count: total })}
              </p>
              {pickFiltersActive(f) && (
                <Button size="sm" variant="ghost" icon="close" onClick={f.reset}>
                  {t('team.pick.clear')}
                </Button>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="bg-dusk-900 p-4 text-sm text-mist-300 inset-shadow-well">{t('team.pick.noMatch')}</p>
          ) : (
            <ul aria-label={t('team.fromBox')} className="flex max-h-[min(30rem,70dvh)] flex-col gap-2 overflow-y-auto pr-1">
              {rows.map((row) => (
                <PickItem key={row.mon.uid} row={row} full={full} disabled={disabled} onAction={onAction} />
              ))}
            </ul>
          )}
          {full && <p className="mt-3 text-sm text-mist-400">{t('team.full')}</p>}
        </>
      )}

      <Dialog
        open={swap?.open ?? false}
        onOpenChange={(open) => !open && setSwap((s) => s && { ...s, open: false })}
        size="md"
        title={t('team.swap.title', { name: incoming ? names.species(incoming.speciesSlug) : '' })}
        description={t('team.swap.body', { name: incoming ? names.species(incoming.speciesSlug) : '' })}
      >
        <ol className="flex flex-col gap-2">
          {members.map((m, i) => (
            <SwapMember key={m.mon.uid} row={m} index={i} incomingName={incoming ? names.species(incoming.speciesSlug) : ''} disabled={disabled} onPick={onSwap} />
          ))}
        </ol>
      </Dialog>
    </Panel>
  )
}

export const BoxPicker = memo(BoxPickerPanel)

/** "×1.35" next to the type that gives it (same value PreSession and the team cards show). */
function Boost({ type, mult }: { type: TypeSlug; mult: number }) {
  const { t } = useTranslation()
  const names = useNames()
  const text = t('conditions.memberBoost', { type: names.type(type), mult: mult.toFixed(2) })
  return (
    <span className="inline-flex items-center gap-1" title={text}>
      <TypeBadge type={type} />
      <span className="font-num text-lg leading-none text-leaf-400" aria-hidden="true">
        ×{mult.toFixed(2)}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  )
}

function StateLabel({ state }: { state: PickRow['state'] }) {
  const { t } = useTranslation()
  if (state === 'ready') return null
  return (
    <span className="inline-flex items-center gap-1 text-sm text-amber-400">
      <PixelIcon name={state === 'asleep' ? 'sleep' : 'bolt'} size={10} />
      {t(state === 'asleep' ? 'team.pick.asleep' : 'team.pick.exhausted')}
    </span>
  )
}

const PickItem = memo(function PickItem({ row, full, disabled, onAction }: { row: PickRow; full: boolean; disabled: boolean; onAction: (uid: string) => void }) {
  const { t } = useTranslation()
  const names = useNames()
  const { mon } = row
  const name = names.species(mon.speciesSlug)
  const dim = row.state !== 'ready'
  return (
    // content-visibility keeps hundreds of rows cheap to lay out and paint.
    <li className="flex items-center gap-3 bg-dusk-900 p-2 inset-shadow-well [contain-intrinsic-size:auto_5rem] [content-visibility:auto]">
      <span className={cx('grid h-16 w-20 shrink-0 place-items-center', dim && 'opacity-50')}>
        <Sprite kind="icon" slug={mon.speciesSlug} scale={2} alt="" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cx('flex items-baseline gap-2', dim && 'opacity-70')}>
          <span className="truncate font-display text-base">{name}</span>
          {mon.isShiny && (
            <span className="text-volt-300" aria-label={t('pokemon.shiny')}>
              ★
            </span>
          )}
          <span className="font-num text-lg leading-none text-mist-300">
            {t('pokemon.levelShort')}
            {mon.level}
          </span>
        </span>
        <span className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', dim && 'opacity-70')}>
          {row.types.map((ty) => (ty === row.condType ? <Boost key={ty} type={ty} mult={row.mult} /> : <TypeBadge key={ty} type={ty} />))}
          {row.condType && !row.types.includes(row.condType) && <Boost type={row.condType} mult={row.mult} />}
          <span className="max-sm:hidden">
            <RoleBadge role={row.role} />
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <ProgressBar className="w-16 shrink-0" size="sm" variant="energy" value={row.energy} max={row.maxEnergy} label={t('pokemon.energyOf', { name })} />
          <span className="font-num text-base leading-none tabular text-mist-300">
            {Math.round(row.energy)}/{Math.round(row.maxEnergy)}
          </span>
          <StateLabel state={row.state} />
        </span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        icon={full ? 'reroll' : 'plus'}
        disabled={disabled}
        aria-label={t(full ? 'team.pick.swapOf' : 'team.pick.addOf', { name })}
        className="max-sm:size-9 max-sm:gap-0 max-sm:px-0!"
        onClick={() => onAction(mon.uid)}
      >
        <span className="max-sm:sr-only">{t(full ? 'team.pick.swap' : 'team.add')}</span>
      </Button>
    </li>
  )
})

/** One team member in the swap chooser: pick it to give its slot to the incoming Pokémon. */
function SwapMember({ row, index, incomingName, disabled, onPick }: { row: PickRow; index: number; incomingName: string; disabled: boolean; onPick: (uid: string) => void }) {
  const { t } = useTranslation()
  const names = useNames()
  const { mon } = row
  const name = names.species(mon.speciesSlug)
  const leader = index === 0
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(mon.uid)}
        aria-label={t('team.swap.pickOf', { out: name, in: incomingName })}
        className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 bg-dusk-900 p-2 text-left inset-shadow-well hover:bg-dusk-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={cx('grid size-8 place-items-center font-num text-xl leading-none shadow-frame', leader ? 'bg-volt-400 text-ink' : 'bg-dusk-700 text-mist-100')}
          aria-hidden="true"
        >
          {leader ? <PixelIcon name="crown" size={16} /> : index + 1}
        </span>
        <span className={cx('grid h-12 w-16 place-items-center', row.state !== 'ready' && 'opacity-50')}>
          <Sprite kind="icon" slug={mon.speciesSlug} alt="" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-display text-base">{name}</span>
            <span className="font-num text-lg leading-none text-mist-300">
              {t('pokemon.levelShort')}
              {mon.level}
            </span>
            {row.condType && <span className="font-num text-lg leading-none text-leaf-400">×{row.mult.toFixed(2)}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ProgressBar className="w-16 shrink-0" size="sm" variant="energy" value={row.energy} max={row.maxEnergy} label={t('pokemon.energyOf', { name })} />
            <span className="font-num text-base leading-none tabular text-mist-300">
              {Math.round(row.energy)}/{Math.round(row.maxEnergy)}
            </span>
            <StateLabel state={row.state} />
          </span>
        </span>
      </button>
    </li>
  )
}
