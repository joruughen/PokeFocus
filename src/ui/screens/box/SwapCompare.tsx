import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PokemonView } from '../../../engine'
import { Button, Dialog, DialogClose, PixelIcon, RoleBadge, Sprite, toast, TypeBadge } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { useNames } from '../../lib/names'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useTeamViews } from '../../store/selectors'
import { swapInTeam } from '../team/pickFromBox'
import { numberRows, onlyHere, type NumberRow, type Verdict } from './swapCompare'

/** Marks a difference with more than color: an icon and a screen-reader word. */
function Mark({ v }: { v: Verdict }) {
  const { t } = useTranslation()
  if (v === 'same') return null
  return (
    <>
      <PixelIcon name={v === 'better' ? 'up' : 'down'} size={10} className={cx('shrink-0', v === 'better' ? 'text-leaf-400' : 'text-cheek-400')} />
      <span className="sr-only">{t(v === 'better' ? 'swapCmp.higher' : 'swapCmp.lower')}</span>
    </>
  )
}

/** One cell of a comparison row; `diff` highlights what is not on the other side. */
function Cell({ children, diff, className }: { children: ReactNode; diff?: boolean; className?: string }) {
  const { t } = useTranslation()
  return (
    <dd className={cx('m-0 min-w-0 px-2 py-1.5', diff ? 'bg-volt-400/10 outline-1 -outline-offset-1 outline-volt-400/60' : 'bg-dusk-900', className)}>
      {children}
      {diff && <span className="sr-only"> ({t('swapCmp.differs')})</span>}
    </dd>
  )
}

function Row({ label, a, b }: { label: ReactNode; a: ReactNode; b: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-mist-400">{label}</dt>
      <div className="grid grid-cols-2 gap-2">{a}{b}</div>
    </div>
  )
}

function NumCell({ n, v, text }: { n: number; v: Verdict; text?: string }) {
  return (
    <Cell className="flex items-center justify-between gap-1">
      <span className={cx('font-num text-2xl leading-none tabular', v === 'better' ? 'text-leaf-400' : v === 'worse' ? 'text-cheek-400' : 'text-mist-100')}>{text ?? Math.round(n)}</span>
      <Mark v={v} />
    </Cell>
  )
}

function Identity({ view, role }: { view: PokemonView; role: 'in' | 'out' }) {
  const { t } = useTranslation()
  const names = useNames()
  const p = view.pokemon
  const species = names.species(p.speciesSlug)
  return (
    <div className={cx('flex min-w-0 flex-col items-center gap-1 p-2 text-center shadow-frame', role === 'in' ? 'bg-dusk-700' : 'bg-dusk-900')}>
      <span className="font-display text-xs text-mist-300">{t(role === 'in' ? 'swapCmp.entering' : 'swapCmp.leaving')}</span>
      <Sprite kind="icon" slug={p.speciesSlug} shiny={p.isShiny} scale={2} alt="" />
      <span className="max-w-full font-display text-base leading-tight [overflow-wrap:anywhere]">
        {names.pokemon(p)}
        {p.isShiny && (
          <span className="ml-1 text-volt-300" aria-label={t('pokemon.shiny')}>
            ★
          </span>
        )}
      </span>
      {p.nickname && <span className="max-w-full text-xs text-mist-400 [overflow-wrap:anywhere]">{species}</span>}
    </div>
  )
}

function Techniques({ view, other }: { view: PokemonView; other: PokemonView }) {
  const { t } = useTranslation()
  const names = useNames()
  const only = onlyHere(view.pokemon.equippedMoves, other.pokemon.equippedMoves)
  if (view.equipped.length === 0) return <span className="text-sm text-mist-400">{t('swapCmp.noTechniques')}</span>
  return (
    <ul className="flex flex-col gap-1">
      {view.equipped.map((m) => (
        <li key={m.slug} className={cx('flex min-w-0 items-center gap-1.5 text-sm', only.has(m.slug) && 'text-volt-300')}>
          <TypeBadge type={m.type} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {names.move(m.slug)}
            {only.has(m.slug) && <span className="sr-only"> ({t('swapCmp.differs')})</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export interface SwapCompareViewProps {
  incoming: PokemonView
  outgoing: PokemonView
  /** Team slot (0 = leader) the incoming Pokémon would take. */
  slot: number
}

/**
 * Side-by-side comparison of the Pokémon that comes in (left) and the one that
 * leaves (right): level, Energy, stats, types, role, ability and techniques,
 * with differences marked. Props only (no store), so it renders in tests.
 */
export function SwapCompareView({ incoming, outgoing, slot }: SwapCompareViewProps) {
  const { t } = useTranslation()
  const names = useNames()
  const rows = useMemo(() => numberRows(incoming, outgoing), [incoming, outgoing])
  const label = (r: NumberRow) => (r.label === 'level' ? t('swapCmp.level') : r.label === 'energy' ? t('swapCmp.energyNow') : t(`stats.${r.label}.name`))
  const typesDiff = [...incoming.types].sort().join() !== [...outgoing.types].sort().join()
  const roleDiff = incoming.species.role !== outgoing.species.role
  const abilityOf = (v: PokemonView) => v.pokemon.ability
  const abilityDiff = abilityOf(incoming) !== abilityOf(outgoing)
  const ability = (v: PokemonView) => (abilityOf(v) ? <span className="text-sm [overflow-wrap:anywhere]">{names.ability(abilityOf(v)!)}</span> : <span className="text-sm text-mist-400">—</span>)
  return (
    <div className="flex flex-col gap-3" data-testid="swap-compare">
      <div className="grid grid-cols-2 gap-2">
        <Identity view={incoming} role="in" />
        <Identity view={outgoing} role="out" />
      </div>
      <dl className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <Row
            key={r.key}
            label={label(r)}
            a={<NumCell n={r.a} v={r.va} text={r.label === 'energy' ? `${Math.round(r.a)}/${Math.round(incoming.maxEnergy)}` : undefined} />}
            b={<NumCell n={r.b} v={r.vb} text={r.label === 'energy' ? `${Math.round(r.b)}/${Math.round(outgoing.maxEnergy)}` : undefined} />}
          />
        ))}
        <Row
          label={t('swapCmp.types')}
          a={<Cell diff={typesDiff}><span className="flex flex-wrap gap-1">{incoming.types.map((ty) => <TypeBadge key={ty} type={ty} />)}</span></Cell>}
          b={<Cell diff={typesDiff}><span className="flex flex-wrap gap-1">{outgoing.types.map((ty) => <TypeBadge key={ty} type={ty} />)}</span></Cell>}
        />
        <Row
          label={t('swapCmp.role')}
          a={<Cell diff={roleDiff}><RoleBadge role={incoming.species.role} /></Cell>}
          b={<Cell diff={roleDiff}><RoleBadge role={outgoing.species.role} /></Cell>}
        />
        <Row label={t('swapCmp.ability')} a={<Cell diff={abilityDiff}>{ability(incoming)}</Cell>} b={<Cell diff={abilityDiff}>{ability(outgoing)}</Cell>} />
        <Row label={t('swapCmp.techniques')} a={<Cell><Techniques view={incoming} other={outgoing} /></Cell>} b={<Cell><Techniques view={outgoing} other={incoming} /></Cell>} />
      </dl>
      <p className="flex items-start gap-2 text-sm text-mist-300">
        <PixelIcon name={slot === 0 ? 'crown' : 'team'} size={10} className={cx('mt-[5px] shrink-0', slot === 0 && 'text-volt-400')} />
        <span>{t(slot === 0 ? 'swapCmp.takesLeader' : 'swapCmp.takesSlot', { name: names.pokemon(incoming.pokemon), n: slot + 1 })}</span>
      </p>
    </div>
  )
}

/** One team member in the "who leaves?" step. */
function PickMember({ view, slot, disabled, onPick, incomingName }: { view: PokemonView; slot: number; disabled: boolean; onPick: () => void; incomingName: string }) {
  const { t } = useTranslation()
  const names = useNames()
  const p = view.pokemon
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        aria-label={t('swapCmp.pickOf', { out: names.pokemonFull(p), in: incomingName })}
        className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 bg-dusk-900 p-2 text-left inset-shadow-well hover:bg-dusk-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={cx('grid size-8 place-items-center font-num text-xl leading-none shadow-frame', slot === 0 ? 'bg-volt-400 text-ink' : 'bg-dusk-700 text-mist-100')} aria-hidden="true">
          {slot === 0 ? <PixelIcon name="crown" size={16} /> : slot + 1}
        </span>
        <Sprite kind="icon" slug={p.speciesSlug} alt="" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate font-display text-base">{names.pokemon(p)}</span>
            <span className="shrink-0 font-num text-lg leading-none text-mist-300">
              {t('pokemon.levelShort')}
              {p.level}
            </span>
          </span>
          {p.nickname && <span className="truncate text-xs text-mist-400">{names.species(p.speciesSlug)}</span>}
        </span>
      </button>
    </li>
  )
}

/**
 * "Swap for…" on the Pokémon sheet (full team): step 1 picks the member who
 * leaves, step 2 compares both and asks for confirmation. Nothing changes
 * until "Yes, swap". Not available during a session.
 */
export function SwapDialog({ open, onOpenChange, incoming }: { open: boolean; onOpenChange: (open: boolean) => void; incoming: PokemonView }) {
  const { t } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const setTeam = useGame((s) => s.setTeam)
  const busy = useBusy()
  const [outUid, setOutUid] = useState<string | null>(null)
  const views = useTeamViews(player, now)
  const outgoing = views.find((v) => v.pokemon.uid === outUid) ?? null
  const slot = outUid ? player.team.indexOf(outUid) : -1
  const locked = Boolean(player.activeSession)
  const incomingName = names.pokemon(incoming.pokemon)

  const close = (o: boolean) => {
    if (!o) setOutUid(null)
    onOpenChange(o)
  }
  const confirm = async () => {
    if (!outgoing || busy || locked) return
    const next = swapInTeam(player.team, outgoing.pokemon.uid, incoming.pokemon.uid)
    if (!next) {
      toast.add({ title: errorText('duplicate_in_team', 'box'), type: 'danger' })
      return
    }
    const err = await setTeam(next)
    if (err) {
      toast.add({ title: errorText(err, 'box'), type: 'danger' })
      return
    }
    close(false)
    toast.add({ title: t(slot === 0 ? 'team.swap.doneLeader' : 'team.swap.done', { in: incomingName, out: names.pokemon(outgoing.pokemon) }), type: 'success' })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size={outgoing ? 'lg' : 'md'}
      title={outgoing ? t('swapCmp.title', { in: incomingName, out: names.pokemon(outgoing.pokemon) }) : t('swapCmp.pickTitle', { name: incomingName })}
      description={outgoing ? undefined : t('swapCmp.pickBody', { name: incomingName })}
      footer={
        outgoing ? (
          <>
            <Button variant="ghost" icon="back" onClick={() => setOutUid(null)}>
              {t('common.back')}
            </Button>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button icon="reroll" disabled={busy || locked} onClick={() => void confirm()}>
              {t('swapCmp.confirm')}
            </Button>
          </>
        ) : undefined
      }
    >
      {outgoing ? (
        <div className="flex flex-col gap-4">
          <SwapCompareView incoming={incoming} outgoing={outgoing} slot={slot} />
          <p className="font-display text-lg text-mist-50" role="status">
            {t('swapCmp.sure')}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {views.map((v, i) => (
            <PickMember key={v.pokemon.uid} view={v} slot={i} disabled={busy || locked} incomingName={incomingName} onPick={() => setOutUid(v.pokemon.uid)} />
          ))}
        </ol>
      )}
    </Dialog>
  )
}
