import { useTranslation } from 'react-i18next'
import { InfoTip, Switch, toast } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { useGame } from '../../store/game'
import { useBusy, usePlayer } from '../../store/selectors'

/**
 * "Auto" damage preference (`PlayerState.autoDamage`). It is copied into the
 * encounter when the session is claimed, so it can change before, during and
 * on the claim screen. `compact` = one quiet line (focus session).
 */
export function AutoDamageToggle({ disabled, compact, className }: { disabled?: boolean; compact?: boolean; className?: string }) {
  const { t } = useTranslation()
  const player = usePlayer()
  const setAutoDamage = useGame((s) => s.setAutoDamage)
  const busy = useBusy()
  const on = Boolean(player.autoDamage)
  const onChange = async (v: boolean) => {
    const err = await setAutoDamage(v)
    if (err) toast.add({ title: errorText(err), type: 'danger' })
  }
  return (
    <div className={cx('flex items-center gap-3 text-left', className)}>
      <Switch checked={on} onChange={(v) => void onChange(v)} label={t('damage.toggle.label')} disabled={disabled || busy} />
      <div className="min-w-0">
        <p className={cx('flex items-center gap-1', compact ? 'text-sm text-mist-300' : 'font-display text-base')}>
          {t('damage.toggle.label')}
          <InfoTip content={t('damage.toggle.tip')} />
        </p>
        {!compact && <p className="text-sm text-mist-400">{on ? t('damage.toggle.on') : t('damage.toggle.off')}</p>}
      </div>
    </div>
  )
}
