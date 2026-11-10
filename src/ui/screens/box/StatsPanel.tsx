import { useTranslation } from 'react-i18next'
import { abilityOutlook, defaultContext, ivQuality, type BaseStats, type PokemonView, type StatKey } from '../../../engine'
import { ArtIcon, CategoryChip, HelpDot, InfoTip, IvQuality, Panel, Stars, STAT_ICON, STAT_ORDER, StatRow, Tabs } from '../../components'
import { hintAnchor } from '../../hints'
import { useNames } from '../../lib/names'
import { statBreakdown } from './statBreakdown'
import { useContent } from '../../store/content'

export type StatsTab = 'stats' | 'ivs'

/**
 * Quality tier (0–4) of ONE stat's IV, with the engine's own thresholds:
 * `ivQuality` of six equal IVs is exactly that fraction of the maximum.
 */
export function ivStatTier(iv: number): 0 | 1 | 2 | 3 | 4 {
  const ctx = defaultContext()
  return ivQuality({ hp: iv, attack: iv, defense: iv, specialAttack: iv, specialDefense: iv, speed: iv }, ctx).tier
}

/** Seconds → "2 min 51 s". */
function fmtInterval(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m} min ${s} s` : `${s} s`
}

/**
 * Detail sheet card with two tabs: "Estadísticas" (the stats the Pokémon has
 * now, nature, ability, origin) and "IVs" (how good its fixed IVs are, as a
 * quality rating: GDD §6.1 and the `detail.iv` hint keep the exact 0–31
 * values hidden, only the wild "reveal" effect shows quality too).
 */
export function StatsPanel({ view, initialTab = 'stats' }: { view: PokemonView; initialTab?: StatsTab }) {
  const { t } = useTranslation()
  return (
    <Panel className="relative">
      {/* The Panel's own "?" is gone with its title: the tab strip is the header, so the stats help sits at its right edge. */}
      <HelpDot hint="detail.stats" className="absolute top-[1.65rem] right-8 z-20" />
      <Tabs
        label={t('detail.tabsLabel')}
        defaultValue={initialTab}
        items={[
          { value: 'stats', label: t('detail.tabStats'), content: <StatsTab view={view} /> },
          { value: 'ivs', label: t('detail.tabIvs'), content: <IvsTab view={view} /> },
        ]}
      />
    </Panel>
  )
}

function StatsTab({ view }: { view: PokemonView }) {
  const ctx = useContent()
  const { t, i18n } = useTranslation()
  const names = useNames()
  const p = view.pokemon
  const nature = ctx.naturesBySlug.get(p.nature)
  const statScale = Math.max(50, Math.ceil(Math.max(...STAT_ORDER.map((k) => view.stats[k])) / 50) * 50)
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {STAT_ORDER.map((k) => (
          <StatRow key={k} stat={k} value={view.stats[k]} nature={p.nature} breakdown={statBreakdown(p, k, ctx)} scale={statScale} className="grid-cols-[9.5rem_1fr_3rem]" />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-1.5 bg-dusk-900 p-3 text-sm text-mist-300 inset-shadow-well">
        <li>{t('detail.every', { time: fmtInterval(view.actionIntervalSeconds) })}</li>
        <li>{t('detail.perAction', { points: view.pointsPerAction.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })}</li>
        <li>{t('detail.techMult', { mult: view.techniqueMultiplier.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</li>
      </ul>

      <dl className="mt-5 flex flex-col gap-4">
        <div>
          <dt className="flex items-center gap-2 font-display text-base text-mist-300">
            {t('detail.nature')}
            <InfoTip label={t('roleInfo.natureAria')} content={<span className="flex flex-col gap-1"><span className="font-display text-base">{t('detail.nature')}</span><span>{t('roleInfo.natureTip')}</span></span>} />
          </dt>
          <dd className="mt-0.5">
            <span className="font-display text-lg text-mist-50">{names.nature(p.nature)}</span>{' '}
            {nature?.increased && nature.decreased ? (
              <span className="text-sm">
                <span className="text-leaf-400">+{t(`stats.${nature.increased}.name`)}</span> <span className="text-cheek-400">−{t(`stats.${nature.decreased}.name`)}</span>
              </span>
            ) : (
              <span className="text-sm text-mist-400">{t('detail.neutral')}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-display text-base text-mist-300">{t('detail.ability')}</dt>
          <dd className="mt-0.5">
            {p.ability ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg text-mist-50">{names.ability(p.ability)}</span>
                  <CategoryChip kind="passive" outlook={abilityOutlook(p)} pokemonName={names.pokemon(p)} />
                </span>
                <p className="text-sm text-mist-300">{names.abilityDesc(p.ability)}</p>
              </>
            ) : (
              <span className="text-sm text-mist-400">{t('detail.noAbility')}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-display text-base text-mist-300">{t('detail.met')}</dt>
          <dd className="mt-0.5 text-sm text-mist-300">
            {p.caughtBall === 'starter'
              ? t('detail.starter')
              : t('detail.caughtWith', { level: p.metLevel, ball: p.caughtBall === 'study-ball' ? t('balls.study') : names.item(p.caughtBall), date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(p.caughtAt) })}
          </dd>
        </div>
      </dl>
    </>
  )
}

function IvsTab({ view }: { view: PokemonView }) {
  const ctx = useContent()
  const { t } = useTranslation()
  const ivs: BaseStats = view.pokemon.ivs
  const ivMax = ctx.config.progression.ivMax
  // What each IV adds to the stat today: the stat with its IV minus the same stat with that IV at 0 (same species, level and nature).
  const p = view.pokemon
  const adds = (k: StatKey) => statBreakdown(p, k, ctx).iv
  return (
    <>
      <div {...hintAnchor('detail.iv')}>
        <p className="flex items-center gap-2 font-display text-base text-mist-300">
          {t('iv.overall')}
          <HelpDot hint="detail.iv" />
        </p>
        <div className="mt-1">
          <IvQuality ivs={ivs} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1.5 text-sm text-mist-300">
        <p>{t('iv.what')}</p>
        <p>{t('iv.fixed')}</p>
        <p>{t('iv.effect')}</p>
        <p>{t('iv.where')}</p>
      </div>

      <h3 className="mt-5 mb-2 font-display text-base text-mist-300">{t('iv.perStat')}</h3>
      <ul className="flex flex-col gap-2.5">
        {STAT_ORDER.map((k: StatKey) => {
          const tier = ivStatTier(ivs[k])
          const word = t(`iv.tier.${tier}`)
          const name = t(`stats.${k}.name`)
          return (
            <li key={k} className="grid grid-cols-[9.5rem_1fr] items-center gap-3" aria-label={t('iv.rowLabel', { stat: name, iv: ivs[k], max: ivMax, word, adds: adds(k) })}>
              <span className="flex items-center gap-1.5 font-display text-base text-mist-100">
                <ArtIcon name={STAT_ICON[k]} size={24} className="text-volt-300" />
                {name}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Stars value={tier} max={4} label={t('iv.statLabel', { stat: name, word })} />
                <span className="text-xs text-mist-300">{word}</span>
                <span className="font-num text-xl leading-none tabular">
                  {ivs[k]}
                  <span className="text-base text-mist-400">/{ivMax}</span>
                </span>
                <span className="text-xs text-mist-400">{t('iv.adds', { n: adds(k) })}</span>
                {ivs[k] >= ivMax && <span className="bg-volt-400 px-1 font-display text-xs text-ink">{t('iv.max')}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
