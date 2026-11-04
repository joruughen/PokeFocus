import { useTranslation } from 'react-i18next'
import { ivQuality, type BaseStats } from '../../engine'
import { cx } from '../lib/cx'
import { Stars } from './Stars'

/** IV quality (engine `ivQuality`): 4 stars + a word. `ink` tone for light nameplates. */
export function IvQuality({ ivs, tone = 'volt', showWord = true, className }: { ivs: BaseStats; tone?: 'volt' | 'ink'; showWord?: boolean; className?: string }) {
  const { t } = useTranslation()
  const q = ivQuality(ivs)
  const word = t(`iv.tier.${q.tier}`)
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <Stars value={q.tier} max={4} tone={tone} label={t('iv.label', { word })} />
      {showWord && <span className={cx('text-xs', tone === 'ink' ? 'text-dusk-700' : 'text-mist-300')}>{word}</span>}
    </span>
  )
}
