import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activationChance, defaultContext, type PokemonView, type TechniqueInfo } from '../../../engine'
import { Button, CategoryChip, HelpDot, Panel, PixelIcon, Stars, toast, Tooltip, TypeBadge } from '../../components'
import { hintAnchor } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useGame } from '../../store/game'
import { useBusy } from '../../store/selectors'

const cfg = defaultContext().config
const SLOT_LEVELS = cfg.progression.techniqueSlots

/**
 * Technique slots (1–4 by level, GDD §7): equip/unequip from the moves it
 * knows, with category, numbers, Mastery stars and locked extra moves.
 * Equipping when the slots are full enters a "replace" mode: pick which slot.
 */
export function Techniques({ view, locked }: { view: PokemonView; locked: string | null }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const equip = useGame((s) => s.equip)
  const busy = useBusy()
  const [pending, setPending] = useState<string | null>(null)
  const p = view.pokemon
  const equipped = p.equippedMoves
  const free = view.slots - equipped.length
  const available = view.equippable.filter((m) => !equipped.includes(m.slug))
  const name = names.species(p.speciesSlug)

  const save = async (moves: string[], msg: string) => {
    if (busy) return
    const err = await equip(p.uid, moves)
    if (err) {
      toast.add({ title: errorText(err, 'box'), type: 'danger' })
      return
    }
    sfx(moves.length > equipped.length ? 'newMove' : 'uiClose', { volume: 0.7 })
    toast.add({ title: msg, type: 'success' })
    setPending(null)
  }
  const onEquip = (slug: string) => {
    if (free > 0) save([...equipped, slug], t('tech.equipped', { move: names.move(slug), name }))
    else setPending(pending === slug ? null : slug)
  }
  const onReplace = (index: number) => {
    if (!pending) return
    const next = [...equipped]
    const old = next[index]!
    next[index] = pending
    save(next, t('tech.replaced', { move: names.move(pending), old: names.move(old) }))
  }

  return (
    <Panel title={t('tech.title')} help="detail.techniques" {...hintAnchor('detail.slots')}>
      <p className="-mt-2 mb-4 max-w-[62ch] text-sm text-mist-300">{t('tech.intro')}</p>
      {locked && <p className="mb-4 flex items-center gap-2 bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well"><PixelIcon name="lock" size={20} />{locked}</p>}

      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label={t('tech.slotsLabel', { count: view.slots })}>
        {SLOT_LEVELS.map((s, i) => {
          if (i >= view.slots) {
            return (
              <li key={i} className="flex min-h-24 items-center gap-3 bg-ink/20 px-4 py-3 text-mist-400 outline-2 -outline-offset-2 outline-dusk-600 outline-dashed">
                <PixelIcon name="lock" size={20} className="shrink-0" />
                <span className="text-sm">{t('tech.slotLocked', { level: s.level })}</span>
              </li>
            )
          }
          const slug = equipped[i]
          const info = slug ? view.equipped.find((m) => m.slug === slug) : undefined
          if (!slug || !info) {
            return (
              <li key={i} className="flex min-h-24 items-center gap-3 bg-ink/20 px-4 py-3 outline-2 -outline-offset-2 outline-volt-400/60 outline-dashed">
                <PixelIcon name="plus" size={20} className="shrink-0 text-volt-400" />
                <span className="text-sm text-mist-100">{t('tech.slotEmpty')}</span>
              </li>
            )
          }
          return (
            <li key={i} className={cx('bg-dusk-900 p-3 inset-shadow-well', pending && 'outline-2 outline-volt-400 outline-dashed')}>
              <TechCard info={info} view={view} lng={i18n.language} />
              <div className="mt-3 flex justify-end gap-2">
                {pending ? (
                  <Button size="sm" icon="reroll" onClick={() => onReplace(i)} disabled={Boolean(locked) || busy}>
                    {t('tech.replaceHere')}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon="minus" disabled={Boolean(locked) || busy} onClick={() => save(equipped.filter((m) => m !== slug), t('tech.unequipped', { move: names.move(slug) }))}>
                    {t('tech.unequip')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {pending && (
        <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-volt-300" aria-live="polite">
          {t('tech.pickSlot', { move: names.move(pending) })}
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
        </p>
      )}

      <h3 className="mt-6 mb-3 flex items-center gap-2 text-lg">
        {t('tech.known')}
        <HelpDot hint="detail.mastery" />
      </h3>
      {available.length === 0 ? (
        <p className="text-sm text-mist-300">{t('tech.noneMore')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {available.map((m) => (
            <li key={m.slug} className={cx('grid grid-cols-1 items-center gap-3 bg-dusk-900 p-3 inset-shadow-well sm:grid-cols-[minmax(0,1fr)_auto]', pending === m.slug && 'outline-3 outline-volt-400')}>
              <TechCard info={m} view={view} lng={i18n.language} />
              <Button size="sm" variant={pending === m.slug ? 'primary' : 'secondary'} icon="plus" disabled={Boolean(locked) || busy} onClick={() => onEquip(m.slug)} aria-pressed={pending === m.slug}>
                {free > 0 ? t('tech.equip') : t('tech.swap')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {view.lockedExtraMoves.length > 0 && (
        <>
          <h3 className="mt-6 mb-3 flex items-center gap-2 text-lg">
            {t('tech.lockedTitle')}
            <HelpDot hint="detail.extraMoves" />
          </h3>
          <ul className="flex flex-col gap-2">
            {view.lockedExtraMoves.map(({ technique, unlockLevel }) => (
              <li key={technique.slug} className="grid grid-cols-1 items-center gap-3 bg-ink/20 p-3 outline-2 -outline-offset-2 outline-dusk-600 outline-dashed sm:grid-cols-[minmax(0,1fr)_auto]">
                <TechCard info={technique} view={view} lng={i18n.language} dim />
                <span className="inline-flex items-center gap-2 font-display text-base text-mist-300">
                  <PixelIcon name="lock" size={20} />
                  {t('tech.unlocksAt', { level: unlockLevel })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

/** One technique: name, category, type, its numbers, Mastery and what it does. */
function TechCard({ info, view, lng, dim }: { info: TechniqueInfo; view: PokemonView; lng: string; dim?: boolean }) {
  const { t } = useTranslation()
  const names = useNames()
  const m = view.mastery[info.slug]
  const def = info.def
  const desc = info.kind === 'damage' ? t('tech.damageDesc', { type: names.type(info.type), power: info.power }) : names.technique(info.slug)
  const nextTier = m ? cfg.progression.mastery[m.stars] : undefined
  const eff = def?.baseChance && m ? activationChance(def.baseChance, view.stats.specialDefense, m.minutes, 1, cfg) : null
  return (
    <div className={cx('min-w-0', dim && 'opacity-70')}>
      {/* Same layout in every card: name on the left, Mastery stars at the top right, chips on their own row. */}
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-display text-lg leading-tight text-mist-50">{names.move(info.slug)}</span>
        {m && (
          <Tooltip
            variant="help"
            content={
              <span className="flex flex-col gap-1">
                <span className="font-display text-base">{t('tech.masteryTitle', { stars: m.stars })}</span>
                <span>{t('tech.masteryBody', { hours: (m.minutes / 60).toFixed(1), mult: m.mult.toFixed(2) })}</span>
                {nextTier && <span className="text-xs text-dusk-500">{t('tech.masteryNext', { hours: nextTier.hours, stars: m.stars + 1 })}</span>}
              </span>
            }
          >
            <button type="button" className="mt-0.5 inline-flex shrink-0 items-center" aria-label={t('tech.masteryAria', { stars: m.stars })}>
              <Stars value={m.stars} max={5} label="" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <CategoryChip kind={info.kind} />
        <TypeBadge type={info.type} />
      </div>
      <p className="mt-1 text-sm leading-snug text-mist-300">{desc}</p>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-mist-400">
        {info.kind === 'damage' && <span>{t('tech.power', { power: info.power })}</span>}
        {def?.baseChance !== undefined && (
          <span>
            {t('tech.baseChance', { pct: fmtPct(def.baseChance, lng) })}
            {eff !== null && <span className="text-volt-300"> {t('tech.effChance', { pct: fmtPct(eff, lng) })}</span>}
          </span>
        )}
        {def?.limitPerSession !== undefined && <span>{t('tech.limit', { count: def.limitPerSession })}</span>}
        {def?.limitPerWeek !== undefined && <span>{t('tech.limitWeek', { count: def.limitPerWeek })}</span>}
      </p>
    </div>
  )
}
