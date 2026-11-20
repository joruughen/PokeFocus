import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  bondBonus,
  isAsleepAt,
  candyDustCost,
  levelCap,
  previewCandies,
  type CandyPreview,
  type CandyKind,
  type EvolutionOption,
  type PokemonView,
  type ProgressEvent,
  type TypeSlug,
} from '../../../engine'
import { Button, HelpDot, IconButton, Panel, PixelIcon, ProgressBar, Sprite, toast } from '../../components'
import { emitHintEvent, hintAnchor } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { expProgress } from '../../lib/expProgress'
import { fmtHours, fmtInt, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { navigate } from '../../router'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer } from '../../store/selectors'
import { lineRoot, useEvoCondition } from '../shared/EvoLine'
import { EvolutionPreview } from './EvolutionPreview'
import { useContent } from '../../store/content'

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
  const cfg = useContent().config
  const { t, i18n } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const feed = useGame((s) => s.feedCandy)
  const busy = useBusy()
  const lng = i18n.language
  const p = view.pokemon
  const name = names.pokemon(p)
  const cap = levelCap(player)
  const atCap = p.level >= cap
  const cost = candyDustCost(p.level)
  const exp = expProgress(view, cfg.progression.maxLevel)
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
            {fmtInt(exp.value, lng)}/{fmtInt(exp.max, lng)}
          </span>
        </div>
        <ProgressBar variant="exp" value={exp.value} max={exp.max} label={t('pokemon.expOf', { name })} />
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
            <CandyRow key={k.key} label={k.label} have={k.have} exp={k.exp} cost={cost} kind={k.kind} uid={p.uid} disabled={Boolean(locked) || busy}
              onUse={async (n) => {
                if (busy) return
                const r = await feed(p.uid, k.kind, n)
                if (!r.ok) {
                  toast.add({ title: errorText(r.error, 'box'), type: 'danger' })
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

function CandyRow({ label, have, exp, cost, kind, disabled, uid, onUse }: { label: string; have: number; exp: number; cost: number; kind: CandyKind; disabled: boolean; uid: string; onUse: (n: number) => void }) {
  const { t } = useTranslation()
  const player = usePlayer()
  const [n, setN] = useState(1)
  const dustOk = player.dust >= cost
  const count = Math.max(1, Math.min(n, Math.max(1, have)))
  const r = previewCandies(player, uid, kind, count)
  const preview = r.ok ? r.value : null
  const why = have === 0 ? t('candy.noneOfThese') : !dustOk ? t('candy.noDust', { cost }) : null
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
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon="minus" size="sm" label={t('candy.less')} onClick={() => setN(Math.max(1, count - 1))} disabled={count <= 1} />
            <span className="w-8 text-center font-num text-2xl leading-none tabular" aria-live="polite">{count}</span>
            <IconButton icon="plus" size="sm" label={t('candy.more')} onClick={() => setN(Math.min(have, count + 1))} disabled={count >= have} />
            <Button size="sm" className="ml-auto" disabled={disabled || !preview || preview.used < 1} onClick={() => preview && onUse(preview.used)} data-sfx="none">
              {t('candy.use', { count: preview?.used ?? count })}
            </Button>
          </div>
          {preview && <CandyPreviewBox preview={preview} asked={count} />}
        </div>
      )}
    </li>
  )
}

/** What the chosen amount would do (engine `previewCandies`). Nothing is applied until the button is pressed. */
export function CandyPreviewBox({ preview: v, asked }: { preview: CandyPreview; asked: number }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const up = v.levelTo > v.levelFrom
  const sameLevel = !up
  return (
    <div className="flex flex-col gap-2 border-2 border-dashed border-mist-400/30 p-2" data-testid="candy-preview">
      <span className="font-display text-sm uppercase tracking-wide text-mist-400">{t('candy.preview.title')}</span>
      {up ? (
        <span key={v.levelTo} className="flex animate-pop-in items-center gap-1.5 whitespace-nowrap font-num text-2xl leading-none text-volt-300 tabular">
          <PixelIcon name="sparkle" size={14} className="animate-twinkle" />
          {t('candy.preview.levelUp', { from: v.levelFrom, to: v.levelTo })}
        </span>
      ) : (
        <span className="whitespace-nowrap font-num text-2xl leading-none tabular text-mist-100">{t('candy.preview.level', { level: v.levelTo })}</span>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs text-mist-400">
            <span>{t('candy.preview.before')}</span>
            <span className="font-num tabular">{fmtInt(v.intoFrom, lng)}/{fmtInt(v.forNextFrom, lng)}</span>
          </div>
          <ProgressBar size="sm" variant="exp" value={v.intoFrom} max={v.forNextFrom} label={t('candy.preview.before')} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs text-mist-100">
            <span>{t('candy.preview.after')}</span>
            <span className="font-num tabular">{fmtInt(v.intoTo, lng)}/{fmtInt(v.forNextTo, lng)}</span>
          </div>
          <ProgressBar size="sm" variant="exp" value={v.intoTo} max={v.forNextTo} from={sameLevel ? v.intoFrom : undefined} label={t('candy.preview.after')} />
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-mist-300">
        <dt>{t('candy.preview.exp')}</dt>
        <dd className="text-right font-num tabular text-exp-400">+{fmtInt(v.expGained, lng)}</dd>
        <dt>{t('candy.preview.candies')}</dt>
        <dd className="whitespace-nowrap text-right font-num tabular">{t('candy.preview.fromTo', { from: fmtInt(v.candiesLeft + v.used, lng), to: fmtInt(v.candiesLeft, lng), spent: v.used })}</dd>
        <dt>{t('candy.preview.dust')}</dt>
        <dd className="whitespace-nowrap text-right font-num tabular">{t('candy.preview.fromTo', { from: fmtInt(v.dustLeft + v.dustSpent, lng), to: fmtInt(v.dustLeft, lng), spent: fmtInt(v.dustSpent, lng) })}</dd>
      </dl>
      {v.unused > 0 && (
        <p className="flex items-start gap-1 text-xs text-amber-400" role="status">
          <PixelIcon name="lock" size={12} className="mt-0.5 shrink-0" />
          {v.stoppedBy === 'level_cap' ? t('candy.preview.capStop', { cap: v.levelTo, count: v.unused, asked }) : t('candy.preview.dustStop', { count: v.unused, asked })}
        </p>
      )}
    </div>
  )
}

/** Evolution options now (engine `evolutionOptions`), with why each one is blocked. */
export function Evolution({ view, locked, onEvolve }: { view: PokemonView; locked: string | null; onEvolve: (to: string) => void }) {
  const cfg = useContent().config
  const busy = useBusy()
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const cond = useEvoCondition()
  const p = view.pokemon
  const name = names.pokemon(p)
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
      case 'trainer_level_too_low':
        return t('evo.block.trainer', { need: cfg.evolution.stage3.minTrainerLevel, now: player.trainer.level })
      case 'not_enough_candies':
        return t('evo.block.candies', { count: o.candyCost - (player.candies.chains[String(view.species.evolutionChainId)] ?? 0) })
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
            <li key={o.to} className={cx('flex flex-col gap-3 bg-dusk-900 p-3 inset-shadow-well', !o.blockedBy && 'outline-2 outline-volt-400')}>
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-16 shrink-0 place-items-center">
                  <Sprite kind="icon" slug={o.to} scale={2} alt="" className={cx(!player.pokedex.seen.includes(o.to) && 'brightness-0 opacity-60')} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg leading-tight">{player.pokedex.seen.includes(o.to) ? names.species(o.to) : t('dex.unknownName')}</span>
                  <span className="block text-sm text-mist-300">{cond(o.evolution)}</span>
                  {o.blockedBy && <span className="block text-xs text-amber-400">{blocked(o)}</span>}
                  {o.candyCost > 0 && <span className="block text-xs text-mist-300">{t('evo.cost', { count: o.candyCost, have: player.candies.chains[String(view.species.evolutionChainId)] ?? 0 })}</span>}
                  {o.evolution.trigger === 'item' && o.evolution.item && <span className="block text-xs text-mist-400">{t('evo.itemHave', { count: player.inventory[o.evolution.item] ?? 0 })}</span>}
                </span>
              </div>
              <EvolutionPreview pokemon={p} to={o.to} />
              <Button icon="sparkle" className="w-full justify-center" disabled={Boolean(o.blockedBy) || Boolean(locked) || busy} onClick={() => onEvolve(o.to)} beacon={!o.blockedBy && !locked} data-sfx="none">
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
  const cfg = useContent().config
  const { t, i18n } = useTranslation()
  const now = useNow()
  const names = useNames()
  const player = usePlayer()
  const heal = useGame((s) => s.heal)
  const busy = useBusy()
  const lng = i18n.language
  const p = view.pokemon
  const name = names.pokemon(p)
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
                  disabled={!usable || inSession || busy}
                  data-sfx="none"
                  onClick={async () => {
                    const err = await heal(p.uid, k)
                    if (err) toast.add({ title: errorText(err, 'heal'), type: 'danger' })
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
        <span className="text-mist-300">{t('bond.minutes', { hours: fmtHours(p.bondMinutes, lng) })}</span>
        <span className="font-num text-xl leading-none text-leaf-400">+{fmtPct(bond, lng)}</span>
      </div>
      <ProgressBar className="mt-1" variant="volt" value={bond} max={cfg.bond.maxBonus} label={t('bond.title')} />
      <p className="mt-1 text-xs text-mist-400">{t('bond.note', { max: fmtPct(cfg.bond.maxBonus, lng) })}</p>
    </Panel>
  )
}

