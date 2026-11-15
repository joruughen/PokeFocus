/**
 * Building blocks of the Trades screen (GDD §12.8): the summary card of a
 * Pokémon in a trade, the picker of my Pokémon (with why some cannot be
 * offered), the warnings list and the error text. Pure views over props, so
 * they render on the server in tests.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { defaultContext, type OwnedPokemon, type PlayerState } from '../../../engine'
import type { TradePokemonView } from '../../../game/protocol'
import { isApiError } from '../../api/client'
import { IvQuality, MonTile, PixelIcon, Sprite, Switch, TextField } from '../../components'
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

/** Summary sheet of a Pokémon in a trade: species, level, shiny, IVs, nature, ability, techniques, original trainer. */
export function TradeMonCard({ mon, title, evolvedTo, className }: { mon: TradePokemonView; title?: string; evolvedTo?: string | null; className?: string }) {
  const { t, i18n: { language } } = useTranslation()
  const names = useNames()
  const name = names.species(mon.speciesSlug)
  return (
    <section aria-label={title ? `${title}: ${name}` : name} className={cx('flex min-w-0 flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well', mon.missing && 'opacity-60', className)}>
      {title && <p className="font-display text-sm text-mist-300">{title}</p>}
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-16 shrink-0 place-items-center bg-dusk-800 shadow-frame">
          <Sprite kind="icon" slug={mon.speciesSlug} shiny={mon.isShiny} alt="" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 font-display text-lg leading-tight">
            <span className="truncate">{name}</span>
            {mon.isShiny && <PixelIcon name="sparkle" size={14} className="text-volt-300" label={t('pokemon.shiny')} />}
          </p>
          <p className="text-sm text-mist-300">
            {t('pokemon.levelShort')} {mon.level}
          </p>
          <IvQuality ivs={mon.ivs} />
        </div>
      </div>
      {mon.missing && <p className="text-sm text-cheek-400">{t('trades.card.missing')}</p>}
      {evolvedTo && <p className="text-sm text-volt-300">{t('trades.card.evolvedTo', { name: names.species(evolvedTo) })}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-mist-400">{t('trades.card.nature')}</dt>
        <dd>{names.nature(mon.nature)}</dd>
        <dt className="text-mist-400">{t('trades.card.ability')}</dt>
        <dd>{mon.ability ? names.ability(mon.ability) : t('detail.noAbility')}</dd>
        <dt className="text-mist-400">{t('trades.card.moves')}</dt>
        <dd>
          {mon.equippedMoves.length === 0
            ? '—'
            : mon.equippedMoves.map((m) => {
                const h = (mon.moveMasteryMinutes[m] ?? 0) / 60
                return (
                  <span key={m} className="mr-2 inline-block">
                    {names.move(m)}
                    {h >= 1 && <span className="text-mist-400"> ({t('trades.card.masteryHours', { count: Math.floor(h) })})</span>}
                  </span>
                )
              })}
        </dd>
        {mon.traded && (
          <>
            <dt className="text-mist-400">{t('trades.card.ot')}</dt>
            <dd>
              {mon.traded.originalTrainer}
              <span className="text-mist-400"> · {t('trades.card.tradedTimes', { count: mon.traded.count, date: new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(mon.traded.receivedAt) })}</span>
            </dd>
          </>
        )}
      </dl>
    </section>
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
