import { useTranslation } from 'react-i18next'
import type { TechniqueKind } from '../../engine'
import { cx } from '../lib/cx'
import { PixelIcon, type IconName } from './PixelIcon'

const STYLE: Record<TechniqueKind, { icon: IconName; cls: string }> = {
  damage: { icon: 'bolt', cls: 'bg-cheek-500 text-mist-50' },
  passive: { icon: 'shield', cls: 'bg-exp-600 text-mist-50' },
  activable: { icon: 'sparkle', cls: 'bg-volt-400 text-ink' },
}

/** Technique category (GDD §7.1): damage / passive / activable. */
export function CategoryChip({ kind, className }: { kind: TechniqueKind; className?: string }) {
  const { t } = useTranslation()
  const s = STYLE[kind]
  return (
    <span className={cx('inline-flex h-5 items-center gap-1 px-1.5 font-display text-sm leading-none whitespace-nowrap shadow-frame', s.cls, className)}>
      <PixelIcon name={s.icon} size={10} />
      {t(`technique.kind.${kind}`)}
    </span>
  )
}
