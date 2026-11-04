import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  bondBonus,
  isAsleepAt,
  candyDustCost,
  defaultContext,
  levelCap,
  levelFromExp,
  type CandyKind,
  type EvolutionOption,
  type PokemonView,
  type ProgressEvent,
  type TypeSlug,
} from '../../../engine'
import { Button, HelpDot, IconButton, Panel, PixelIcon, ProgressBar, Sprite, toast } from '../../components'
import { emitHintEvent, hintAnchor } from '../../hints'
import { cx } from '../../lib/cx'
import { fmtInt, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { navigate } from '../../router'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { usePlayer } from '../../store/selectors'
import { lineRoot, useEvoCondition } from '../shared/EvoLine'

const ctx = defaultContext()
const cfg = ctx.config

/** Announce level ups / new moves / evolutions after candies (toasts + sfx + hint event). */
export function announceProgress(events: ProgressEvent[], name: string, t: (k: string, o?: Record<string, unknown>) => string, moveName: (s: string) => string, speciesName: (s: string) => string) {
  const ups = events.filter((e): e is Extract<ProgressEvent, { type: 'levelUp' }> => e.type === 'levelUp')
  if (ups.length > 0) {
    const last = ups[ups.length - 1]!
    sfx('levelUp')
    const moves = ups.flatMap((u) => u.newMoves)
    toast.add({
      title: t('candy.levelUp', { name, level: last.to }),
      description: moves.length > 0 ? t('candy.newMoves', { moves: moves.map(moveName).join(', ') }) : ups.some((u) => u.slotsUnlocked) ? t('results.newSlot') : undefined,
      type: 'success',
    })
    if (moves.length > 0) setTimeout(() => sfx('newMove'), 1300)
  }
  const evo = events.find((e) => e.type === 'evolutionAvailable')
  if (evo && evo.type === 'evolutionAvailable') {
    toast.add({ title: t('results.evolution', { name, to: speciesName(evo.to) }), type: 'info' })
    emitHintEvent('evolveReady')
  }
}

/** Use species or type candies (cost in Dust per candy at the current level; stops at the level cap). */
export function Candies({ view, locked }: { view: PokemonView; locked: string | null }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const feed = useGame((s) => s.feedCandy)
  const lng = i18n.language
  const p = view.pokemon
  const name = names.species(p.speciesSlug)
  const cap = levelCap(player)
  const atCap = p.level >= cap
  const cost = candyDustCost(p.level)
  const root = lineRoot(view.species)
  const kinds: { key: string; kind: CandyKind; have: number; exp: number; label: string }[] = [
    { key: 'species', kind: { kind: 'species' }, have: player.candies.chains[String(view.species.evolutionChainId)] ?? 0, exp: cfg.progression.candyExp, label: t('bag.lineCandy', { name: names.species(root.slug) }) },
    ...view.types.map((ty: TypeSlug) => ({ key: ty, kind: { kind: 'type', type: ty } as CandyKind, have: player.candies.types[ty] ?? 0, exp: cfg.progression.typeCandyExp, label: t('bag.typeCandy', { type: names.type(ty) }) })),
  ]
  const nextCap = cfg.progression.levelCaps.find((c) => c.cap > cap)

  return (
    <Panel title={t('candy.title')} help="detail.candies" {...hintAnchor('detail.candies')}>
      <div className="mb-4">
        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
          <span className="text-mist-300">{t('candy.toNext', { level: p.level + 1 })}</span>
          <span className="font-num text-lg leading-none tabular">
            {fmtInt(view.expIntoLevel, lng)}/{fmtInt(view.expForNextLevel, lng)}
          </span>
        </div>
        <ProgressBar variant="exp" value={view.expIntoLevel} max={view.expForNextLevel} label={t('pokemon.expOf', { name })} />
      </div>

      {atCap ? (
        <div className="flex items-start gap-3 bg-dusk-900 p-3 inset-shadow-well" {...hintAnchor('detail.cap')}>
          <PixelIcon name="lock" size={20} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-sm">
            <p className="font-display text-base text-amber-400">{t('candy.capTitle', { cap })}</p>
            <p className="text-mist-300">{nextCap ? t('candy.capBody', { species: nextCap.species, caught: player.pokedex.caught.length, cap: nextCap.cap }) : t('candy.capMax')}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="secondary" icon="dex" onClick={() => navigate('dex')}>
                {t('candy.toDex')}
              </Button>
              <HelpDot hint="detail.levelCap" />
            </div>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {kinds.map((k) => (
            <CandyRow key={k.key} label={k.label} have={k.have} exp={k.exp} cost={cost} dust={player.dust} disabled={Boolean(locked)} level={p.level} exp0={p.exp} cap={cap}
              onUse={(n) => {
                const r = feed(p.uid, k.kind, n)
                if (!r.ok) {
                  toast.add({ title: t(`errors.box.${r.error}`), type: 'danger' })
                  return
                }
                sfx('claim', { volume: 0.6 })
                toast.add({ title: t('candy.used', { count: r.used, name, dust: fmtInt(r.dustSpent, lng) }), type: 'success' })
                announceProgress(r.events, name, t, names.move, names.species)
              }}
            />
          ))}
        </ul>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-mist-400">
        <PixelIcon name="dust" size={10} className="text-exp-400" />
        {t('candy.costNote', { cost, dust: fmtInt(player.dust, lng) })}
      </p>
    </Panel>
  )
}

function CandyRow({ label, have, exp, cost, dust, disabled, level, exp0, cap, onUse }: { label: string; have: number; exp: number; cost: number; dust: number; disabled: boolean; level: number; exp0: number; cap: number; onUse: (n: number) => void }) {
  const { t } = useTranslation()
  const affordable = Math.max(0, Math.min(have, Math.floor(dust / Math.max(1, cost))))
  const [n, setN] = useState(1)
  const count = Math.max(1, Math.min(n, Math.max(1, affordable)))
  const reach = Math.min(cap, levelFromExp(exp0 + count * exp))
  const why = have === 0 ? t('candy.noneOfThese') : affordable === 0 ? t('candy.noDust', { cost }) : null
  return (
    <li className={cx('bg-dusk-900 p-3 inset-shadow-well', have === 0 && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <PixelIcon name="candy" size={20} className="shrink-0 text-volt-300" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-mist-100">{label}</span>
          <span className="block text-xs text-mist-400">{t('candy.each', { exp })}</span>
        </span>
        <span className="font-num text-2xl leading-none tabular">{have}</span>
      </div>
      {why ? (
        <p className="mt-2 text-xs text-mist-400">{why}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <IconButton icon="minus" size="sm" label={t('candy.less')} onClick={() => setN(Math.max(1, count - 1))} disabled={count <= 1} />
          <span className="w-8 text-center font-num text-2xl leading-none tabular" aria-live="polite">{count}</span>
          <IconButton icon="plus" size="sm" label={t('candy.more')} onClick={() => setN(Math.min(affordable, count + 1))} disabled={count >= affordable} />
          <Button size="sm" className="ml-auto" disabled={disabled} onClick={() => onUse(count)} data-sfx="none">
            {t('candy.use', { count })}
          </Button>
          <span className="w-full text-xs text-mist-300">{reach > level ? t('candy.reach', { level: reach }) : t('candy.reachSame')}</span>
        </div>
      )}
    </li>
  )
}

/** Evolution options now (engine `evolutionOptions`), with why each one is blocked. */
export function Evolution({ view, locked, onEvolve }: { view: PokemonView; locked: string | null; onEvolve: (to: string) => void }) {
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const cond = useEvoCondition()
  const p = view.pokemon
  const name = names.species(p.speciesSlug)
  const blocked = (o: EvolutionOption): string => {
    switch (o.blockedBy) {
      case 'level_too_low':
        return t('evo.block.level', { count: (o.evolution.minLevel ?? 1) - p.level })
      case 'missing_item':
        return t('evo.block.item', { item: o.evolution.item ? names.item(o.evolution.item) : '' })
      case 'bond_too_low':
        return t('evo.block.bond', { pct: fmtPct(cfg.bond.friendshipEvolutionBond, names.lng), now: fmtPct(bondBonus(p.bondMinutes), names.lng) })
      case 'wrong_time_of_day':
        return o.evolution.timeOfDay === 'day' ? t('evo.block.day') : t('evo.block.night')
      case 'trade_unavailable':
        return t('evo.block.trade')
      default:
        return t('evo.block.other')
    }
  }
  return (
    <Panel title={t('evo.title')} help="detail.evolve" {...hintAnchor('detail.evolve')}>
      {view.evolutions.length === 0 ? (
        <p className="text-sm text-mist-300">{view.species.evolvesFrom ? t('evo.final', { name }) : t('evo.none', { name })}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.evolutions.map((o) => (
            <li key={o.to} className={cx('flex flex-wrap items-center gap-3 bg-dusk-900 p-3 inset-shadow-well', !o.blockedBy && 'outline-2 outline-volt-400')}>
              <span className="grid h-14 w-16 place-items-center">
                <Sprite kind="icon" slug={o.to} scale={2} alt="" className={cx(!player.pokedex.seen.includes(o.to) && 'brightness-0 opacity-60')} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg leading-tight">{player.pokedex.seen.includes(o.to) ? names.species(o.to) : t('dex.unknownName')}</span>
                <span className="block text-sm text-mist-300">{cond(o.evolution)}</span>
                {o.blockedBy && <span className="block text-xs text-amber-400">{blocked(o)}</span>}
                {o.evolution.trigger === 'item' && o.evolution.item && <span className="block text-xs text-mist-400">{t('evo.itemHave', { count: player.inventory[o.evolution.item] ?? 0 })}</span>}
              </span>
              <Button icon="sparkle" disabled={Boolean(o.blockedBy) || Boolean(locked)} onClick={() => onEvolve(o.to)} beacon={!o.blockedBy && !locked} data-sfx="none">
                {t('evo.button')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Energy now (+ healing items) and Bond. */
export function EnergyBond({ view, inSession }: { view: PokemonView; inSession: boolean }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const names = useNames()
  const player = usePlayer()
  const heal = useGame((s) => s.heal)
  const lng = i18n.language
  const p = view.pokemon
  const name = names.species(p.speciesSlug)
  const inTeam = player.team.includes(p.uid)
  const healItems = Object.keys(cfg.energy.potions).concat('revive').filter((k) => (player.inventory[k] ?? 0) > 0)
  const bond = bondBonus(p.bondMinutes)
  const exhausted = view.energy <= 0
  return (
    <Panel title={t('energy.title')} help="detail.energy" {...hintAnchor('detail.energy')}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-display text-base text-mist-300">{t('stats.hp.name')}</span>
        <span className="font-num text-2xl leading-none tabular">
          {Math.round(view.energy)}/{Math.round(view.maxEnergy)}
        </span>
      </div>
      <ProgressBar variant="energy" value={view.energy} max={view.maxEnergy} label={t('pokemon.energyOf', { name })} />
      <p className="mt-2 text-sm text-mist-300">
        {exhausted ? t('pokemon.exhausted') : t('energy.actionsLeft', { count: view.actionsLeft })} {inTeam ? t('energy.teamRegen') : t('energy.boxRegen', { pct: fmtPct(cfg.energy.boxRecoverPctPerHour, lng) })}
      </p>
      {isAsleepAt(player, p, now) && <p className="mt-2 flex items-center gap-2 text-sm text-exp-400"><PixelIcon name="sleep" size={20} />{t('energy.asleep')}</p>}

      <h3 className="mt-5 mb-2 text-lg">{t('energy.heal')}</h3>
      {healItems.length === 0 ? (
        <p className="text-sm text-mist-400">{t('energy.noHeal')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {healItems.map((k) => {
            const amount = k === 'revive' ? null : cfg.energy.potions[k]
            const usable = k === 'revive' ? exhausted : view.energy < view.maxEnergy
            return (
              <li key={k} className="flex items-center gap-3">
                <span className="grid h-8 w-10 place-items-center">
                  <Sprite kind="item" slug={k} fit={30} alt="" />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {names.item(k)} <span className="text-mist-400">×{player.inventory[k]}</span>
                  <span className="block text-xs text-mist-400">{amount !== null ? t('energy.potionDesc', { amount }) : t('energy.reviveDesc', { pct: fmtPct(cfg.energy.revivePct, lng) })}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="potion"
                  disabled={!usable || inSession}
                  data-sfx="none"
                  onClick={() => {
                    const err = heal(p.uid, k)
                    if (err) toast.add({ title: t(`errors.heal.${err}`), type: 'danger' })
                    else {
                      sfx('heal')
                      toast.add({ title: t('energy.healed', { name, item: names.item(k) }), type: 'success' })
                    }
                  }}
                >
                  {t('energy.use')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <h3 className="mt-5 mb-2 flex items-center gap-2 text-lg">
        {t('bond.title')}
        <HelpDot hint="detail.bond" />
      </h3>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-mist-300">{t('bond.minutes', { hours: (p.bondMinutes / 60).toFixed(1) })}</span>
        <span className="font-num text-xl leading-none text-leaf-400">+{fmtPct(bond, lng)}</span>
      </div>
      <ProgressBar className="mt-1" variant="volt" value={bond} max={cfg.bond.maxBonus} label={t('bond.title')} />
      <p className="mt-1 text-xs text-mist-400">{t('bond.note', { max: fmtPct(cfg.bond.maxBonus, lng) })}</p>
    </Panel>
  )
}

