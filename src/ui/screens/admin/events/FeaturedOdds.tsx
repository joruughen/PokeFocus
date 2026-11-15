import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { defaultContext } from '../../../../engine'
import { atLeastOne, averageWaveSize, featuredOdds, oneInN, wavesPerAppearance, type FeaturedOdds as Odds } from '../../../../game/content/spawnOdds'
import { Segmented } from '../../../components'
import { asLocale, speciesName } from '../../../lib/names'
import { fmtChance } from '../../events/model'

/** Trainer levels the admin can pick as the reference for the estimate. */
export const REFERENCE_LEVELS = [1, 10, 20, 30] as const
export type ReferenceLevel = (typeof REFERENCE_LEVELS)[number]

/** Featured rows of a draft (`species` + text multiplier) as the numbers the estimate needs; unusable rows are skipped. */
export function oddsOfDraft(featured: readonly { species: string; weightMult: string }[], level: number): Map<string, Odds> {
  const rows = featured
    .map((f) => ({ species: f.species, weightMult: Number(f.weightMult.replace(',', '.')) }))
    .filter((f) => f.species !== '' && Number.isFinite(f.weightMult) && f.weightMult > 0)
  return new Map(featuredOdds(defaultContext(), rows, level).map((o) => [o.slug, o]))
}

/** "1 in 70" / "fewer than 1 in 500" / "does not appear". */
export function oneInText(t: TFunction, p: number): string {
  const one = oneInN(p)
  if (!one) return t('eventsAdmin.featured.odds.none')
  return t(one.tiny ? 'eventsAdmin.featured.odds.oneInTiny' : 'eventsAdmin.featured.odds.oneIn', { n: one.n })
}

/** Which trainer level the estimate is for. */
export function ReferenceLevelPicker({ value, onChange }: { value: ReferenceLevel; onChange: (v: ReferenceLevel) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-display text-base text-mist-300">{t('eventsAdmin.featured.odds.refLevelLabel')}</p>
      <Segmented<`${ReferenceLevel}`>
        label={t('eventsAdmin.featured.odds.refLevelLabel')}
        size="md"
        value={`${value}`}
        onChange={(v) => onChange(Number(v) as ReferenceLevel)}
        options={REFERENCE_LEVELS.map((l) => ({ value: `${l}` as `${ReferenceLevel}`, label: `${t('pokemon.levelShort')} ${l}` }))}
      />
      <p className="text-xs text-mist-400">{t('eventsAdmin.featured.odds.note')}</p>
    </div>
  )
}

/**
 * Under one featured species: its estimated chance per wild Pokémon without / with the event at the reference
 * trainer level, a warning when it cannot appear there, and a ready-to-adapt sentence for the event description.
 */
export function FeaturedOddsNote({ odds, level }: { odds: Odds | undefined; level: number }) {
  const { t, i18n } = useTranslation()
  if (!odds) return null
  const lng = asLocale(i18n.language)
  const o = 'eventsAdmin.featured.odds.'
  if (odds.reach.kind === 'legendary') return <p className="text-sm text-mist-400">{t(o + 'legendary')}</p>
  if (odds.reach.kind === 'evolution') return <p className="text-sm text-amber-400">{t(o + 'cannotEvolution')}</p>
  if (!odds.appears) {
    return <p className="text-sm text-amber-400">{t(o + 'cannotWild', { level, wild: odds.reach.wildLevel, trainer: odds.reach.trainerLevel })}</p>
  }
  const size = averageWaveSize(defaultContext())
  const k = wavesPerAppearance(odds.with, size)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-mist-100">{t(o + 'line', { without: oneInText(t, odds.without), with: oneInText(t, odds.with) })}</p>
      <p className="text-xs text-mist-400">
        {t(k !== null && k > 1 ? o + 'cadence' : o + 'cadenceEach', { p: oneInText(t, odds.with), name: speciesName(odds.slug, lng), size, pct: fmtChance(atLeastOne(odds.with, size), i18n.language), k })}
      </p>
    </div>
  )
}
