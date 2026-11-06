import { useTranslation } from 'react-i18next'
import type { Charge, PlayerState } from '../../../engine'
import { Button, Sprite, Tooltip } from '../../components'
import { useNames } from '../../lib/names'

/** Localized name of what produced a charge: the ability or the technique. */
export function chargeSourceName(charge: Charge, player: PlayerState | null, names: ReturnType<typeof useNames>): string {
  const isAbility = player?.pokemon[charge.sourceUid]?.ability === charge.source
  return isAbility ? names.ability(charge.source) : names.move(charge.source)
}

/** "Parálisis · Pikachu (Electricidad estática)". */
export function useChargeLabel(player: PlayerState | null) {
  const { t } = useTranslation()
  const names = useNames()
  return (c: Charge) => {
    const slug = player?.pokemon[c.sourceUid]?.speciesSlug
    const what = c.kind === 'reroll' ? t('report.charge.reroll') : t(`report.charge.${c.status ?? 'sleep'}`)
    const who = slug ? names.species(slug) : ''
    return t('report.charge.tip', { what, who, source: chargeSourceName(c, player, names) })
  }
}

/**
 * A sleep/paralysis/reroll charge in the Waves screen: the action label, the
 * mini icon of the Pokémon that produced it and a tooltip with who and how.
 */
export function ChargeChip({
  charge,
  player,
  selected,
  disabled,
  onToggle,
}: {
  charge: Charge
  player: PlayerState
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const names = useNames()
  const label = useChargeLabel(player)(charge)
  const slug = player.pokemon[charge.sourceUid]?.speciesSlug
  return (
    <Tooltip content={label}>
      <Button
        variant={selected ? 'primary' : 'secondary'}
        icon={charge.kind === 'reroll' ? 'reroll' : charge.status === 'sleep' ? 'sleep' : 'bolt'}
        disabled={disabled}
        onClick={onToggle}
        aria-pressed={selected}
      >
        {charge.kind === 'reroll' ? t('waves.charges.reroll') : t(`waves.charges.${charge.status ?? 'sleep'}`)}
        <span className="text-sm opacity-75">{chargeSourceName(charge, player, names)}</span>
        {slug && <Sprite kind="icon" slug={slug} alt="" className="-my-3 -mr-2" />}
        <span className="sr-only">{` (${label})`}</span>
      </Button>
    </Tooltip>
  )
}
