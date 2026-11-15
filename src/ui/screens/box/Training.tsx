/**
 * Advanced items on the Pokémon sheet (phase F4): Terastallization, TMs, Mints,
 * Bottle Caps and the Ability Capsule. One row per item with what it does,
 * how many you have and why it cannot be used (trainer level, no item, nothing
 * to change, studying); "Use" opens a dialog to choose and confirm.
 */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ABILITY_CAPSULE,
  abilityCapsuleChoices,
  BOTTLE_CAP,
  bottleCapStats,
  definedAbilities,
  effectiveNature,
  getTechnique,
  isUnlocked,
  mintChoices,
  mintItem,
  TECHNICAL_MACHINE,
  TERA_SHARD,
  teraChoices,
  tmCandidates,
  unlockLevel,
  type AdvancedUnlock,
  type PokemonView,
  type StatKey,
  type TypeSlug,
} from '../../../engine'
import { Button, Dialog, DialogClose, Panel, PixelIcon, Sprite, STAT_ORDER, TeraBadge, toast, TypeBadge } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtTimeLeft } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useContent } from '../../store/content'
import { useGame } from '../../store/game'
import { useBusy, usePlayer } from '../../store/selectors'

type Kind = 'tera' | 'tm' | 'mint' | 'bottleCap' | 'abilityCapsule'

const UNLOCK: Partial<Record<Kind, AdvancedUnlock>> = { tera: 'tera', mint: 'mint', bottleCap: 'bottleCap', abilityCapsule: 'abilityCapsule' }

export function Training({ view, locked }: { view: PokemonView; locked: string | null }) {
  const ctx = useContent()
  const cfg = ctx.config
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const busy = useBusy()
  const game = useGame()
  const [open, setOpen] = useState<Kind | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const p = view.pokemon
  const name = names.pokemon(p)
  const inv = (slug: string) => player.inventory[slug] ?? 0
  const ivMax = cfg.progression.ivMax
  const tera = cfg.advanced.tera

  const tms = tmCandidates(p, ctx)
  const ownedMints = mintChoices(p, ctx).filter((n) => inv(mintItem(n)) > 0)
  const capStats = bottleCapStats(p, ctx)
  const abilities = abilityCapsuleChoices(p, ctx)
  const hidden = p.ability !== null && definedAbilities(view.species, ctx).some((a) => a.slug === p.ability && a.isHidden)
  const effective = ctx.naturesBySlug.get(effectiveNature(p))
  const effectText = (n: { increased: string | null; decreased: string | null } | undefined) =>
    n?.increased && n.decreased ? `+${t(`stats.${n.increased}.name`)} −${t(`stats.${n.decreased}.name`)}` : t('detail.neutral')

  const lockOf = (k: Kind): number | null => {
    const u = UNLOCK[k]
    return u && !isUnlocked(player, u, ctx) ? unlockLevel(u, ctx) : null
  }

  const show = (k: Kind) => {
    setChoice(null)
    setOpen(k)
  }

  const confirm = async () => {
    if (!open || !choice || busy) return
    const kind = open
    const err =
      kind === 'tera'
        ? await game.useTera(p.uid, choice as TypeSlug)
        : kind === 'tm'
          ? await game.useTm(p.uid, choice)
          : kind === 'mint'
            ? await game.useMint(p.uid, choice)
            : kind === 'bottleCap'
              ? await game.useBottleCap(p.uid, choice as StatKey)
              : await game.useAbilityCapsule(p.uid, choice)
    setOpen(null)
    if (err) {
      toast.add({ title: errorText(err, 'box'), type: 'danger' })
      return
    }
    sfx(kind === 'tm' ? 'newMove' : 'claim', { volume: 0.7 })
    const title =
      kind === 'tera'
        ? t('training.tera.done', { name, type: names.type(choice as TypeSlug) })
        : kind === 'tm'
          ? t('training.tm.done', { name, move: names.move(choice) })
          : kind === 'mint'
            ? t('training.mint.done', { name, nature: names.nature(choice) })
            : kind === 'bottleCap'
              ? t('training.bottleCap.done', { name, stat: t(`stats.${choice}.name`), max: ivMax })
              : t('training.abilityCapsule.done', { name, ability: names.ability(choice) })
    toast.add({ title, type: 'success' })
  }

  const rows: { kind: Kind; item: string; status: ReactNode; usable: boolean; note: string | null }[] = [
    {
      kind: 'tera',
      item: TERA_SHARD,
      status: view.tera ? (
        <span className="flex flex-wrap items-center gap-2">
          <TeraBadge tera={view.tera} />
          <span className="text-xs text-mist-300">{t('training.tera.left', { time: fmtTimeLeft(view.tera.msLeft), count: view.tera.sessionsLeft })}</span>
        </span>
      ) : null,
      usable: inv(TERA_SHARD) >= tera.shardCost,
      note: inv(TERA_SHARD) >= tera.shardCost ? t('training.tera.cost', { count: tera.shardCost }) : t('training.tera.need', { count: tera.shardCost, have: inv(TERA_SHARD) }),
    },
    {
      kind: 'tm',
      item: TECHNICAL_MACHINE,
      status: p.tmMoves && p.tmMoves.length > 0 ? <span className="text-xs text-mist-300">{t('training.tm.learned', { moves: p.tmMoves.map(names.move).join(', ') })}</span> : null,
      usable: inv(TECHNICAL_MACHINE) > 0 && tms.length > 0,
      note: tms.length === 0 ? t('training.tm.noneLeft') : t('training.tm.count', { count: tms.length }),
    },
    {
      kind: 'mint',
      item: ownedMints[0] ? mintItem(ownedMints[0]) : mintItem(effectiveNature(p) === 'modest' ? 'jolly' : 'modest'),
      status: (
        <span className="text-xs text-mist-300">
          {t('training.mint.current', { nature: `${names.nature(effectiveNature(p))} (${effectText(effective)})` })}
          {p.mintNature && <> · {t('training.mint.original', { nature: names.nature(p.nature) })}</>}
        </span>
      ),
      usable: ownedMints.length > 0,
      note: ownedMints.length > 0 ? t('training.mint.owned', { count: ownedMints.length }) : t('training.mint.noneOwned'),
    },
    {
      kind: 'bottleCap',
      item: BOTTLE_CAP,
      status: null,
      usable: inv(BOTTLE_CAP) > 0 && capStats.length > 0,
      note: capStats.length === 0 ? t('training.bottleCap.allMax') : null,
    },
    {
      kind: 'abilityCapsule',
      item: ABILITY_CAPSULE,
      status: p.ability ? <span className="text-xs text-mist-300">{t('training.abilityCapsule.now', { ability: names.ability(p.ability) })}</span> : null,
      usable: inv(ABILITY_CAPSULE) > 0 && abilities.length > 0,
      note: abilities.length === 0 ? t('training.abilityCapsule.only') : null,
    },
  ]

  const body = (k: Kind) =>
    k === 'tera'
      ? t('training.tera.body', { hours: tera.hours, sessions: tera.sessions })
      : k === 'bottleCap'
        ? t('training.bottleCap.body', { max: ivMax })
        : t(`training.${k}.body`)

  const haveCount = (k: Kind, item: string) => (k === 'mint' ? ownedMints.reduce((n, m) => n + inv(mintItem(m)), 0) : inv(item))

  return (
    <Panel title={t('training.title')}>
      <p className="mb-4 text-sm text-mist-300">{t('training.intro')}</p>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const lockLevel = lockOf(r.kind)
          const have = haveCount(r.kind, r.item)
          return (
            <li key={r.kind} className={cx('flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well', lockLevel !== null && 'opacity-75')}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center">
                  <Sprite kind="item" slug={r.item} fit={32} alt="" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-display text-lg leading-tight">{t(`training.${r.kind}.name`)}</span>
                    <span className="text-xs text-mist-400">{t('training.have', { count: have })}</span>
                  </span>
                  <span className="block text-sm text-mist-300">{body(r.kind)}</span>
                </span>
              </div>
              {r.status}
              {lockLevel !== null ? (
                <p className="flex items-center gap-1.5 text-sm text-amber-400">
                  <PixelIcon name="lock" size={10} className="shrink-0" />
                  {t('training.lockedAt', { level: lockLevel })}
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {r.note ? <span className="min-w-0 flex-1 text-xs text-mist-400">{r.note}</span> : <span />}
                  <Button size="sm" variant="secondary" icon="sparkle" disabled={!r.usable || Boolean(locked) || busy} onClick={() => show(r.kind)} data-sfx="none">
                    {t('training.use')}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        size="md"
        title={open ? t(`training.${open}.dialogTitle`, { name }) : ''}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button icon="sparkle" disabled={!choice || busy} onClick={() => void confirm()} data-sfx="none">
              {open ? t(`training.${open}.confirm`) : ''}
            </Button>
          </>
        }
      >
        {open === 'tera' && (
          <Choices label={t('training.tera.pick')} help={t('training.tera.pickHelp')}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {teraChoices(p, ctx).map((ty) => (
                <Choice key={ty} selected={choice === ty} disabled={view.tera?.type === ty} onSelect={() => setChoice(ty)} className="justify-center p-1.5">
                  <TypeBadge type={ty} />
                </Choice>
              ))}
            </div>
            {view.tera && <p className="mt-3 text-sm text-amber-400">{t('training.tera.replaces', { type: names.type(view.tera.type) })}</p>}
            <p className="mt-2 text-sm text-mist-300">{t('training.tera.cost', { count: tera.shardCost })}</p>
          </Choices>
        )}
        {open === 'tm' && (
          <Choices label={t('training.tm.pick')}>
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
              {tms.map((m) => {
                const info = getTechnique(m, ctx)
                return (
                  <Choice key={m} selected={choice === m} onSelect={() => setChoice(m)}>
                    <span className="min-w-0 flex-1 truncate text-left">{names.move(m)}</span>
                    {info && <TypeBadge type={info.type} />}
                    <span className="w-24 shrink-0 text-right text-xs text-mist-300">
                      {info?.kind === 'damage' ? t('tech.power', { power: info.power }) : info ? t(`technique.kind.${info.kind}`) : ''}
                    </span>
                  </Choice>
                )
              })}
            </div>
          </Choices>
        )}
        {open === 'mint' && (
          <Choices label={t('training.mint.pick')} help={t('training.mint.current', { nature: `${names.nature(effectiveNature(p))} (${effectText(effective)})` })}>
            <div className="flex flex-col gap-1.5">
              {ownedMints.map((n) => (
                <Choice key={n} selected={choice === n} onSelect={() => setChoice(n)}>
                  <Sprite kind="item" slug={mintItem(n)} fit={24} alt="" />
                  <span className="min-w-0 flex-1 text-left">
                    {names.item(mintItem(n))} <span className="text-mist-400">×{inv(mintItem(n))}</span>
                    <span className="block text-xs text-mist-300">{n === p.nature ? t('training.mint.restore') : effectText(ctx.naturesBySlug.get(n))}</span>
                  </span>
                </Choice>
              ))}
            </div>
          </Choices>
        )}
        {open === 'bottleCap' && (
          <Choices label={t('training.bottleCap.pick', { max: ivMax })}>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {STAT_ORDER.map((k) => (
                <Choice key={k} selected={choice === k} disabled={!capStats.includes(k)} onSelect={() => setChoice(k)}>
                  <span className="min-w-0 flex-1 text-left">{t(`stats.${k}.name`)}</span>
                  <span className="font-num text-lg leading-none tabular">{t('training.bottleCap.ivNow', { iv: p.ivs[k] })}</span>
                </Choice>
              ))}
            </div>
          </Choices>
        )}
        {open === 'abilityCapsule' && (
          <Choices label={t('training.abilityCapsule.pick')}>
            {hidden && <p className="mb-2 text-sm text-amber-400">{t('training.abilityCapsule.loseHidden')}</p>}
            <div className="flex flex-col gap-1.5">
              {abilities.map((a) => (
                <Choice key={a} selected={choice === a} onSelect={() => setChoice(a)}>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="font-display text-base">{names.ability(a)}</span>
                    <span className="block text-xs text-mist-300">{names.abilityDesc(a)}</span>
                  </span>
                </Choice>
              ))}
            </div>
          </Choices>
        )}
      </Dialog>
    </Panel>
  )
}

function Choices({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className="mb-1 font-display text-base text-mist-100">{label}</p>
      {help && <p className="mb-2 text-sm text-mist-300">{help}</p>}
      {children}
    </div>
  )
}

function Choice({ selected, disabled, onSelect, className, children }: { selected: boolean; disabled?: boolean; onSelect: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex min-h-11 w-full items-center gap-2 bg-dusk-900 px-2.5 py-1.5 text-sm text-mist-50 shadow-frame hover:bg-dusk-700 disabled:cursor-not-allowed disabled:opacity-40',
        selected && 'outline-2 -outline-offset-2 outline-volt-400',
        className,
      )}
    >
      {children}
    </button>
  )
}
