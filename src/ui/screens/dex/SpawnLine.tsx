import { useTranslation } from 'react-i18next'
import { defaultContext } from '../../../engine'
import { atLeastOne, baseSpawn, exampleWaveSizes, oneInN, type BaseSpawn } from '../../../game/content/spawnOdds'
import { InfoTip } from '../../components'
import { fmtChance } from '../events/model'

/**
 * One quiet line of a Pokédex entry: how often the species is a wild Pokémon at the player's trainer level
 * (average, neutral conditions: see src/game/content/spawnOdds.ts), with a «?» that explains it in terms of waves.
 */
export function SpawnLine({ slug, trainerLevel }: { slug: string; trainerLevel: number }) {
  const { t, i18n } = useTranslation()
  const spawn: BaseSpawn | null = baseSpawn(defaultContext(), slug, trainerLevel)
  if (!spawn) return null

  let text: string
  let help: string
  let chance: number | null = null
  if (spawn.kind === 'chance') {
    chance = spawn.probability
    const one = oneInN(spawn.probability)!
    text = t(one.tiny ? 'dex.spawn.tiny' : 'dex.spawn.chance', { n: one.n })
    help = 'help'
  } else if (spawn.kind === 'fromLevel') {
    text = t('dex.spawn.fromLevel', { wild: spawn.wildLevel, trainer: spawn.trainerLevel })
    help = 'helpFrom'
  } else if (spawn.kind === 'evolution') {
    text = t('dex.spawn.evolution')
    help = 'helpEvolution'
  } else {
    text = t('dex.spawn.legendary', { level: spawn.minLevel })
    help = 'helpLegendary'
  }

  return (
    <p className="flex items-center gap-1 text-sm text-mist-400">
      <span>{text}</span>
      <InfoTip
        label={t('dex.spawn.helpLabel')}
        content={
          <span className="flex flex-col gap-1.5">
            <span>{t(`dex.spawn.${help}`)}</span>
            {chance !== null &&
              exampleWaveSizes(defaultContext()).map((size) => (
                <span key={size}>{t('dex.spawn.example', { size, pct: fmtChance(atLeastOne(chance!, size), i18n.language) })}</span>
              ))}
            {chance !== null && <span>{t('dex.spawn.dependsOn')}</span>}
          </span>
        }
      />
    </p>
  )
}
