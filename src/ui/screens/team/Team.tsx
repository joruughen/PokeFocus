import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TYPES, isAsleepAt, typeEffectiveness, type PokemonView } from '../../../engine'
import { HelpDot, IconButton, Panel, PixelIcon, Platform, PokemonCard, ProgressBar, RoleBadge, Sprite, Stage, toast, TypeBadge } from '../../components'
import { hintAnchor, useHintEvent, useHintScreen } from '../../hints'
import { CopyLookBadge } from '../../components/PokemonCard'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { lookOf } from '../../lib/look'
import { useNames } from '../../lib/names'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useScene, useTeamViews } from '../../store/selectors'
import { BoxPicker } from './BoxPicker'
import { TeamPresetsPanel } from './TeamPresets'
import { boxSize } from './pickFromBox'
import { useContent } from '../../store/content'

/** Team editor: choose up to 6, reorder, pick the leader. Only between sessions. */
export default function Team() {
  useHintScreen('team')
  const { t } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const setTeam = useGame((s) => s.setTeam)
  const setLeader = useGame((s) => s.setLeader)
  const views = useTeamViews(player, now)
  const scene = useScene(player, now)
  const locked = Boolean(player.activeSession)
  const busy = useBusy()
  const minute = Math.floor(now / 60_000)
  const boxCount = boxSize(player)
  const asleep = (v: PokemonView) => isAsleepAt(player, v.pokemon, now)
  const exhausted = views.filter((v) => v.energy <= 0 || asleep(v))
  useHintEvent('teamTired', exhausted.length > 0)

  // Stable, so the Box list rows (memoized) are not re-rendered by every clock tick.
  const apply = useCallback(
    async (uids: string[], msg?: string) => {
      const err = await setTeam(uids)
      if (err) toast.add({ title: errorText(err, 'box'), type: 'danger' })
      else if (msg) toast.add({ title: msg, type: 'success' })
    },
    [setTeam],
  )
  const move = (i: number, d: -1 | 1) => {
    const next = [...player.team]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    apply(next, j === 0 || i === 0 ? t('team.newLeader', { name: names.pokemon(player.pokemon[next[0]!]) }) : undefined)
  }
  const leader = views[0]
  // Which team member the side panel describes (the leader by default, and again if the selected one leaves the team).
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const selectedIndex = Math.max(0, views.findIndex((v) => v.pokemon.uid === selectedUid))
  const selected = views[selectedIndex] ?? leader

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="flex items-center gap-3 text-3xl">
          {t('team.title')}
          <HelpDot hint="team.intro" />
        </h1>
        <p className="mt-1 max-w-[70ch] text-mist-300">{t('team.subtitle')}</p>
      </header>

      {locked && (
        <p className="flex items-center gap-3 bg-dusk-900 p-4 text-amber-400 inset-shadow-well">
          <PixelIcon name="lock" size={20} />
          {t('team.locked')}
        </p>
      )}

      <Stage time={scene.time} weather={scene.weather} className="px-4 pt-8 pb-5">
        <ol className="flex flex-wrap justify-center gap-x-3 gap-y-6 xl:justify-start" aria-label={t('team.title')}>
          {views.map((v, i) => (
            <li
              key={v.pokemon.uid}
              className={cx('w-[10.5rem] cursor-pointer', selected?.pokemon.uid === v.pokemon.uid && 'outline-2 outline-offset-2 outline-volt-400')}
              onClick={() => setSelectedUid(v.pokemon.uid)}
            >
              <PokemonCard view={v} leader={i === 0} night={scene.time === 'night'} dim={asleep(v)} />
            </li>
          ))}
          {Array.from({ length: 6 - views.length }, (_, i) => (
            <li key={`g${i}`} className="flex w-[10.5rem] flex-col items-center max-sm:hidden">
              <div className="flex h-36 w-full items-end justify-center">
                <Platform width={112} ghost night={scene.time === 'night'} />
              </div>
              <p className="mt-2 grid min-h-[6.75rem] w-full place-items-center bg-ink/25 px-3 py-4 text-center font-display text-base text-mist-50/85 outline-2 -outline-offset-2 outline-mist-50/40 outline-dashed">{t('team.slotFree', { n: views.length + i + 1 })}</p>
            </li>
          ))}
        </ol>
      </Stage>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-8">
        <Panel title={t('team.order')} help="team.order" {...hintAnchor('team.slots')}>
          <ol className="flex flex-col gap-3">
            {views.map((v, i) => (
              <SlotRow
                key={v.pokemon.uid}
                view={v}
                asleep={asleep(v)}
                index={i}
                count={views.length}
                selected={selected?.pokemon.uid === v.pokemon.uid}
                onSelect={() => setSelectedUid(v.pokemon.uid)}
                locked={locked || busy}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onLeader={async () => {
                  const err = await setLeader(v.pokemon.uid)
                  if (err) toast.add({ title: errorText(err, 'box'), type: 'danger' })
                  else toast.add({ title: t('team.newLeader', { name: names.pokemon(v.pokemon) }), type: 'success' })
                }}
                onRemove={() => apply(player.team.filter((u) => u !== v.pokemon.uid), t('detail.removed', { name: names.pokemon(v.pokemon) }))}
              />
            ))}
            {views.length < 6 && (
              <li className="flex items-center gap-3 bg-ink/20 p-4 text-sm text-mist-300 outline-2 -outline-offset-2 outline-dusk-600 outline-dashed">
                <PixelIcon name="plus" size={20} className="shrink-0 text-volt-400" />
                {boxCount > 0 ? t('team.addHint', { count: 6 - views.length }) : t('team.emptySlotHow')}
              </li>
            )}
          </ol>
        </Panel>
        <TeamPresetsPanel />
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {selected && <MemberPanel view={selected} index={selectedIndex} />}
          <BoxPicker at={minute * 60_000} disabled={locked || busy} onApply={apply} />
        </div>
      </div>
    </div>
  )
}

function SlotRow({ view, asleep, index, count, selected, onSelect, locked, onUp, onDown, onLeader, onRemove }: { view: PokemonView; asleep: boolean; index: number; count: number; selected: boolean; onSelect: () => void; locked: boolean; onUp: () => void; onDown: () => void; onLeader: () => void; onRemove: () => void }) {
  const SESSION_MIN = useContent().config.session.presets[0] ?? 25
  const { t } = useTranslation()
  const names = useNames()
  const p = view.pokemon
  const look = lookOf(view)
  const name = names.pokemon(p)
  const leader = index === 0
  const tired = !asleep && view.energy > 0 && (SESSION_MIN * 60) / view.actionIntervalSeconds > view.actionsLeft
  const warn = asleep ? { icon: 'sleep' as const, text: t('team.warnAsleep') } : view.energy <= 0 ? { icon: 'bolt' as const, text: t('team.warnExhausted') } : tired ? { icon: 'bolt' as const, text: t('team.warnTired', { minutes: SESSION_MIN }) } : null
  return (
    <li
      className={cx('grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 bg-dusk-900 p-3 inset-shadow-well sm:grid-cols-[auto_minmax(0,1fr)_auto]', selected && 'outline-2 -outline-offset-2 outline-volt-400')}
      onClick={(e) => {
        // A click on the row selects it; the buttons and links inside keep their own job.
        if (!(e.target as HTMLElement).closest('a, button')) onSelect()
      }}
      {...(leader ? hintAnchor('team.leader') : {})}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t('team.selectOf', { name })}
        title={t('team.selectOf', { name })}
        className={cx('grid size-9 place-items-center font-num text-2xl leading-none shadow-frame', leader ? 'bg-volt-400 text-ink' : 'bg-dusk-700 text-mist-100 hover:bg-dusk-600')}
      >
        {leader ? <PixelIcon name="crown" size={20} /> : index + 1}
      </button>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Sprite kind="icon" slug={look.slug} shiny={look.shiny} alt="" />
          <a href={`#/box/${p.uid}`} className="font-display text-lg leading-tight underline decoration-dusk-500 underline-offset-4 hover:text-volt-300">
            <span className="[overflow-wrap:anywhere]">{name}</span>
          </a>
          {p.nickname && <span className="text-sm text-mist-400">{names.species(p.speciesSlug)}</span>}
          <span className="font-num text-xl leading-none text-mist-300">
            {t('pokemon.levelShort')}
            {p.level}
          </span>
          {view.fightTypes.map((ty) => (
            <TypeBadge key={ty} type={ty} />
          ))}
          <RoleBadge role={view.species.role} />
          {view.copy && <CopyLookBadge speciesSlug={view.copy.speciesSlug} />}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <ProgressBar className="max-w-64 flex-1" size="sm" variant="energy" value={view.energy} max={view.maxEnergy} label={t('pokemon.energyOf', { name })} />
          <span className="font-num text-lg leading-none tabular">
            {Math.round(view.energy)}/{Math.round(view.maxEnergy)}
          </span>
        </div>
        {warn && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-amber-400">
            <PixelIcon name={warn.icon} size={10} />
            {warn.text}
          </p>
        )}
        {leader && <p className="mt-1.5 text-sm text-mist-300">{t('team.leaderRow', { grit: Math.round(view.stats.defense) })}</p>}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 sm:col-span-1">
        <IconButton icon="up" size="sm" label={t('team.moveUp', { name })} disabled={locked || index === 0} onClick={onUp} />
        <IconButton icon="down" size="sm" label={t('team.moveDown', { name })} disabled={locked || index === count - 1} onClick={onDown} />
        {!leader && <IconButton icon="crown" size="sm" label={t('team.makeLeaderOf', { name })} disabled={locked} onClick={onLeader} />}
        <IconButton icon="minus" size="sm" variant="ghost" label={t('team.removeOf', { name })} disabled={locked || count <= 1} onClick={onRemove} />
      </div>
    </li>
  )
}

/** The selected team member: the leader by default (it takes the counterattacks, GDD §11.4). Grit, Energy and type weaknesses. */
function MemberPanel({ view, index }: { view: PokemonView; index: number }) {
  const ctx = useContent()
  const { t } = useTranslation()
  const names = useNames()
  const weak = ALL_TYPES.filter((a) => typeEffectiveness(a, view.fightTypes, ctx.chart) > 1)
  const resist = ALL_TYPES.filter((a) => typeEffectiveness(a, view.fightTypes, ctx.chart) < 1)
  const name = names.pokemon(view.pokemon)
  const look = lookOf(view)
  const leader = index === 0
  return (
    <Panel title={leader ? t('team.leaderTitle') : t('team.memberTitle')} help={leader ? 'team.leader' : undefined} {...hintAnchor('team.leaderPanel')}>
      <div className="flex items-center gap-3">
        <span className="grid h-16 w-20 shrink-0 place-items-center bg-dusk-900 inset-shadow-well">
          <Sprite kind="icon" slug={look.slug} shiny={look.shiny} scale={2} alt="" />
        </span>
        <div>
          <p className="flex items-center gap-2 font-display text-xl">
            {leader && <PixelIcon name="crown" size={20} className="text-volt-400" />}
            <span className="[overflow-wrap:anywhere]">{name}</span>
          </p>
          {view.pokemon.nickname && <p className="text-xs text-mist-400">{names.species(view.pokemon.speciesSlug)}</p>}
          <p className="text-sm text-mist-300">{leader ? t('team.leaderWhy') : t('team.memberWhy', { n: index + 1 })}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <RoleBadge role={view.species.role} />
            {view.copy && <CopyLookBadge speciesSlug={view.copy.speciesSlug} />}
            <a href={`#/box/${view.pokemon.uid}`} className="text-sm underline decoration-dusk-500 underline-offset-4 hover:text-volt-300">
              {t('team.seeSheet')}
            </a>
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="bg-dusk-900 p-3 inset-shadow-well">
          <dt className="text-xs text-mist-400">{t('stats.defense.name')}</dt>
          <dd className="font-num text-3xl leading-none">{Math.round(view.stats.defense)}</dd>
          <dd className="mt-1 text-xs text-mist-300">{t('team.gritNote')}</dd>
        </div>
        <div className="bg-dusk-900 p-3 inset-shadow-well">
          <dt className="text-xs text-mist-400">{t('stats.hp.name')}</dt>
          <dd className="font-num text-3xl leading-none">
            {Math.round(view.energy)}
            <span className="text-xl text-mist-400">/{Math.round(view.maxEnergy)}</span>
          </dd>
          <dd className="mt-1 text-xs text-mist-300">{t('team.energyNote')}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="mb-1.5 text-sm text-mist-300">{t('team.weakTo')}</p>
        <div className="flex flex-wrap gap-1.5">
          {weak.length ? weak.map((ty) => <TypeBadge key={ty} type={ty} />) : <span className="text-sm text-mist-400">{t('team.none')}</span>}
        </div>
        <p className="mt-3 mb-1.5 text-sm text-mist-300">{t('team.resists')}</p>
        <div className="flex flex-wrap gap-1.5">
          {resist.length ? resist.map((ty) => <TypeBadge key={ty} type={ty} muted />) : <span className="text-sm text-mist-400">{t('team.none')}</span>}
        </div>
      </div>
    </Panel>
  )
}
