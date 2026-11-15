/**
 * Building blocks of the Trades screen (GDD §12.8): the summary card of a
 * Pokémon in a trade, the picker of my Pokémon (with why some cannot be
 * offered), the warnings list and the error text. Pure views over props, so
 * they render on the server in tests.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { defaultContext, type OwnedPokemon, type PlayerState } from '../../../engine'
import type { TradePokemonView } from '../../../game/protocol'
import { isApiError } from '../../api/client'
import { IvQuality, MonTile, PixelIcon, Platform, Sprite, Switch, TextField } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { offerOptions, type OfferBlock, type TradeWarning } from './eligibility'

/** Text for a refused trade request: `errors.trades.<code>` (or `<code>_partner` when the rule failed for the other player). */
export function tradeErrorText(e: unknown): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return i18n.t('errors.auth.rate_limited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  const side = e.body?.side
  const vars: Record<string, unknown> = {}
  if (typeof e.body?.readyAt === 'number') vars.date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(e.body.readyAt)
  if (side === 'partner' && i18n.exists(`errors.trades.${e.code}_partner`)) return i18n.t(`errors.trades.${e.code}_partner`, vars)
  if (i18n.exists(`errors.trades.${e.code}`)) return i18n.t(`errors.trades.${e.code}`, vars)
  if (e.status === 400) return i18n.t('errors.auth.bad_request')
  return errorText(e.code)
}

/** One side of the link stage: who gives it, and the Pokémon (or an empty platform while it is not picked). */
export interface StageSide {
  /** "You give" / "You get". */
  label: string
  mon: TradePokemonView | null
  /** Shown on the empty platform ("Ana will pick"). */
  pending?: string
  evolvedTo?: string | null
}

/**
 * The trade as a game moment: two Pokémon on platforms facing each other across a link cable,
 * like the handhelds' trade screen. My side is on the left. Under each one, its trainer card
 * (level, IVs, nature, ability, techniques, original trainer). `center`: the Dust both pay.
 * Two columns at every width; at 390 px each plate gets ~170 px.
 */
export function TradeStage({ left, right, center, live }: { left: StageSide; right: StageSide; center?: ReactNode; live?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative grid grid-cols-2 overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-dusk-700),var(--color-dusk-950)_75%)] shadow-plate">
        <StageSpot side={left} facing="right" />
        <StageSpot side={right} facing="left" />
        {/* The link cable between the platforms. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[22%] bottom-[30px] flex items-center">
          <span className="h-0.5 flex-1 bg-[repeating-linear-gradient(90deg,var(--color-volt-400)_0_6px,transparent_6px_10px)] opacity-70" />
          <span className={cx('grid size-9 place-items-center bg-volt-400 text-ink shadow-frame', live && 'motion-safe:animate-bob')}>
            <PixelIcon name="trade" size={20} />
          </span>
          <span className="h-0.5 flex-1 bg-[repeating-linear-gradient(90deg,var(--color-volt-400)_0_6px,transparent_6px_10px)] opacity-70" />
        </div>
      </div>
      {center && <div className="flex justify-center">{center}</div>}
      <div className="grid grid-cols-2 gap-2">
        <MonPlate side={left} />
        <MonPlate side={right} />
      </div>
    </div>
  )
}

function StageSpot({ side, facing }: { side: StageSide; facing: 'left' | 'right' }) {
  const names = useNames()
  const mon = side.mon
  return (
    <div className="relative flex h-40 flex-col items-center justify-end pb-3 sm:h-48">
      <p className="absolute top-2 left-0 w-full px-2 text-center font-display text-sm text-mist-300">{side.label}</p>
      <Platform width={120} night className="absolute bottom-3" />
      {mon ? (
        <Sprite
          kind="showdown"
          slug={mon.speciesSlug}
          shiny={mon.isShiny}
          scale={2}
          maxHeight={110}
          maxWidth={140}
          flip={facing === 'right'}
          alt={names.species(mon.speciesSlug)}
          className={cx('relative mb-3', mon.missing && 'opacity-30 grayscale')}
        />
      ) : (
        <span className="relative mb-6 grid size-16 place-items-center bg-dusk-800/80 font-display text-3xl text-mist-400 shadow-frame" aria-hidden>
          ?
        </span>
      )}
    </div>
  )
}

/** The light nameplate under a Pokémon of the stage (like the trainer ID plate). */
function MonPlate({ side }: { side: StageSide }) {
  const { t, i18n: { language } } = useTranslation()
  const names = useNames()
  const mon = side.mon
  if (!mon) {
    return <div className="grid min-h-24 place-items-center bg-dusk-900 p-3 text-center text-sm text-mist-300 inset-shadow-well">{side.pending}</div>
  }
  const name = names.species(mon.speciesSlug)
  const nature = mon.mintNature && mon.mintNature !== mon.nature ? t('trades.card.mint', { nature: names.nature(mon.nature), mint: names.nature(mon.mintNature) }) : names.nature(mon.nature)
  return (
    <section aria-label={`${side.label}: ${name}`} className="flex min-w-0 flex-col gap-2 bg-mist-50 p-2.5 text-ink shadow-raised sm:p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-display text-lg leading-tight">
          <span className="truncate">{name}</span>
          {mon.isShiny && <PixelIcon name="sparkle" size={14} className="shrink-0 text-cheek-500" label={t('pokemon.shiny')} />}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-dusk-700">
          <span className="font-num text-base">
            {t('pokemon.levelShort')} {mon.level}
          </span>
          <IvQuality ivs={mon.ivs} tone="ink" />
        </p>
      </div>
      {mon.missing && <p className="text-sm font-bold text-cheek-700">{t('trades.card.missing')}</p>}
      {side.evolvedTo && <p className="text-sm text-dusk-700">{t('trades.card.evolvedTo', { name: names.species(side.evolvedTo) })}</p>}
      <dl className="flex flex-col gap-1 text-sm">
        <div>
          <dt className="sr-only">{t('trades.card.nature')}</dt>
          <dd>{nature}</dd>
        </div>
        <div>
          <dt className="sr-only">{t('trades.card.ability')}</dt>
          <dd className="text-dusk-700">{mon.ability ? names.ability(mon.ability) : t('detail.noAbility')}</dd>
        </div>
        <div>
          <dt className="sr-only">{t('trades.card.moves')}</dt>
          <dd className="flex flex-wrap gap-1">
            {mon.equippedMoves.length === 0
              ? '—'
              : mon.equippedMoves.map((m) => {
                  const h = Math.floor((mon.moveMasteryMinutes[m] ?? 0) / 60)
                  return (
                    <span key={m} className="bg-mist-100 px-1.5 py-0.5 text-xs text-ink shadow-[inset_0_0_0_1px_var(--color-mist-300)]" title={h >= 1 ? t('trades.card.masteryHours', { count: h }) : undefined}>
                      {names.move(m)}
                      {h >= 1 && <span className="sr-only"> ({t('trades.card.masteryHours', { count: h })})</span>}
                      {h >= 1 && <span aria-hidden> ★</span>}
                    </span>
                  )
                })}
          </dd>
        </div>
        {(mon.bottleCapped?.length ?? 0) > 0 && <p className="text-xs text-dusk-700">{t('trades.card.capped', { count: mon.bottleCapped!.length })}</p>}
        {mon.teraType && mon.teraUntil && <p className="text-xs text-dusk-700">{t('trades.card.tera', { type: names.type(mon.teraType) })}</p>}
        {mon.traded && (
          <div className="text-xs text-dusk-700">
            <dt className="inline">{t('trades.card.ot')}: </dt>
            <dd className="inline">
              {mon.traded.originalTrainer} ({t('trades.card.tradedTimes', { count: mon.traded.count, date: new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(mon.traded.receivedAt) })})
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/** Dust both players pay, as a small chip under the cable. */
export function DustChip({ cost }: { cost: number }) {
  const { t, i18n: { language } } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5 bg-dusk-800 px-2.5 py-1 text-sm shadow-frame">
      <PixelIcon name="dust" size={14} className="text-exp-400" />
      {t('trades.card.costChip', { cost: fmtInt(cost, language) })}
    </span>
  )
}

/** Text of why a Pokémon cannot be offered. */
export function blockText(block: OfferBlock): string {
  return i18n.t(`trades.block.${block}`)
}

/** One warning line (✓ info / ! blocking). */
export function WarningList({ warnings }: { warnings: TradeWarning[] }) {
  const { t, i18n: { language } } = useTranslation()
  const names = useNames()
  if (warnings.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label={t('trades.warnings.label')}>
      {warnings.map((w) => {
        const bad = w.kind === 'overLevelCap' || w.kind === 'notEnoughDust' || w.kind === 'dailyLimit'
        const text =
          w.kind === 'evolves'
            ? t('trades.warnings.evolves', { name: names.species(w.to) })
            : w.kind === 'overLevelCap'
              ? t('trades.warnings.overLevelCap', { cap: w.cap })
              : w.kind === 'legendaryOnce'
                ? t('trades.warnings.legendaryOnce')
                : w.kind === 'savedTeam'
                  ? t('trades.warnings.savedTeam', { teams: w.teams.join(', ') })
                  : w.kind === 'notEnoughDust'
                    ? t('trades.warnings.notEnoughDust', { cost: fmtInt(w.cost, language), have: fmtInt(w.have, language) })
                    : t('trades.warnings.dailyLimit', { limit: w.limit })
        return (
          <li key={w.kind} className={cx('flex items-start gap-2', bad ? 'text-cheek-400' : w.kind === 'evolves' ? 'text-volt-300' : 'text-amber-400')}>
            <PixelIcon name={bad ? 'close' : w.kind === 'evolves' ? 'sparkle' : 'help'} size={14} className="mt-0.5 shrink-0" />
            <span>{text}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Pick one of my Pokémon to offer or give back: a grid of box tiles with a name filter and an
 * "only the ones I can trade" switch. Blocked ones stay visible (focusable) with their reason.
 */
export function MonPicker({
  player,
  lockedUids,
  selected,
  onSelect,
}: {
  player: PlayerState
  lockedUids: readonly string[]
  selected: string | null
  onSelect: (uid: string) => void
}) {
  const { t } = useTranslation()
  const names = useNames()
  const [query, setQuery] = useState('')
  const [onlyOk, setOnlyOk] = useState(true)
  const options = useMemo(() => offerOptions(player, lockedUids, defaultContext()), [player, lockedUids])
  const q = query.trim().toLocaleLowerCase()
  const shown = options
    .filter((o) => !onlyOk || o.block === null)
    .map((o) => ({ ...o, mon: player.pokemon[o.uid] as OwnedPokemon }))
    .filter((o) => !q || names.pokemonFull(o.mon).toLocaleLowerCase().includes(q) || names.species(o.mon.speciesSlug).toLocaleLowerCase().includes(q))
    .sort((a, b) => b.mon.level - a.mon.level || a.mon.speciesSlug.localeCompare(b.mon.speciesSlug))
  const blocked = options.filter((o) => o.block !== null).length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <TextField className="min-w-48 flex-1" label={t('trades.picker.search')} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        <label className="flex items-center gap-2 pb-2 text-sm text-mist-300">
          <Switch checked={onlyOk} onChange={setOnlyOk} label={t('trades.picker.onlyOk')} />
          <span aria-hidden>{t('trades.picker.onlyOk')}</span>
        </label>
      </div>
      {onlyOk && blocked > 0 && <p className="text-sm text-mist-400">{t('trades.picker.hidden', { count: blocked })}</p>}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-mist-400">{t('trades.picker.none')}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2" aria-label={t('trades.picker.label')}>
          {shown.map((o) => {
            const slot = player.team.indexOf(o.uid)
            return (
              <li key={o.uid}>
                <MonTile
                  mon={o.mon}
                  teamSlot={slot >= 0 ? slot : null}
                  select={{ checked: selected === o.uid, blockedReason: o.block ? blockText(o.block) : undefined }}
                  onClick={() => {
                    if (!o.block) onSelect(o.uid)
                  }}
                  className="w-full"
                />
                {o.block && <p className="mt-1 text-xs text-mist-400">{blockText(o.block)}</p>}
                {!o.block && o.savedTeams.length > 0 && <p className="mt-1 text-xs text-amber-400">{t('trades.picker.inPreset')}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
