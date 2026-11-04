import { useTranslation } from 'react-i18next'
import type { SpeciesRole } from '../../engine'
import { cx } from '../lib/cx'
import { Tooltip } from './Tooltip'

/** The species' PokeFocus role (curation sheet), with what it means on hover/tap. */
export function RoleBadge({ role, className, onLight }: { role: SpeciesRole | undefined; className?: string; onLight?: boolean }) {
  const { t } = useTranslation()
  if (!role) return null
  return (
    <Tooltip variant="help" content={<span className="flex flex-col gap-1"><span className="font-display text-base">{t(`roles.${role}.name`)}</span><span>{t(`roles.${role}.body`)}</span></span>}>
      <button
        type="button"
        className={cx(
          'inline-flex h-5 items-center px-1.5 font-display text-sm leading-none whitespace-nowrap underline decoration-dotted underline-offset-2',
          onLight ? 'bg-dusk-800 text-mist-50' : 'bg-dusk-600 text-mist-50 shadow-frame',
          className,
        )}
      >
        {t(`roles.${role}.name`)}
      </button>
    </Tooltip>
  )
}
