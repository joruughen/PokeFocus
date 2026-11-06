/**
 * Settings → Session: the Web Push switch for THIS browser (lib/push.ts,
 * public/sw.js). The page's own notification stays as it is; this adds the
 * server's fallback notice for a tab the browser froze or closed.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Switch, toast } from '../components'
import { errorCode } from '../api/client'
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../lib/push'

export type PushViewState = PushState | 'checking'

const STATE_KEY: Record<PushViewState, string> = {
  checking: 'settings.push.state.checking',
  unsupported: 'settings.push.state.unsupported',
  'server-off': 'settings.push.state.serverOff',
  denied: 'settings.push.state.denied',
  off: 'settings.push.state.off',
  on: 'settings.push.state.on',
}

const ERROR_CODES = ['no_subscription', 'push_disabled', 'rate_limited', 'network', 'too_many', 'dismissed', 'denied'] as const

/** i18n key for a failed enable / test (unknown codes get the generic line). */
export function pushErrorKey(code: string | undefined): string {
  return (ERROR_CODES as readonly string[]).includes(code ?? '') ? `settings.push.error.${code}` : 'settings.push.error.generic'
}

export interface PushSettingsViewProps {
  state: PushViewState
  busy: boolean
  onToggle: (on: boolean) => void
  onTest: () => void
}

/** Stateless row: label + hint, the switch, the live state line and (when on) the test button. */
export function PushSettingsView({ state, busy, onToggle, onTest }: PushSettingsViewProps) {
  const { t } = useTranslation()
  const canToggle = state === 'off' || state === 'on'
  return (
    <div className="flex flex-col gap-3" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[40ch] min-w-0">
          <p className="font-display text-lg">{t('settings.push.label')}</p>
          <p className="text-sm text-mist-300">{t('settings.push.hint')}</p>
        </div>
        <Switch checked={state === 'on'} onChange={onToggle} label={t('settings.push.label')} disabled={busy || !canToggle} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className={state === 'denied' ? 'text-sm text-amber-400' : 'text-sm text-mist-300'} aria-live="polite" aria-atomic="true">
          {busy ? t('settings.push.busy') : t(STATE_KEY[state])}
        </p>
        {state === 'on' && (
          <Button variant="secondary" onClick={onTest} disabled={busy}>
            {t('settings.push.test')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * `permission` is the Notification permission the Settings row tracks; when it
 * changes (its "Permitir" button) the state is derived again. `onPermission`
 * tells that row when enabling here asked for permission.
 */
export function PushSettings({ permission, onPermission }: { permission?: string; onPermission?: (p: NotificationPermission) => void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<PushViewState>('checking')
  const [busy, setBusy] = useState(false)

  const recheck = useCallback(async () => setState(await pushState()), [])
  useEffect(() => {
    void recheck()
  }, [recheck, permission])

  const toggle = async (on: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      if (on) {
        // Straight from the click: the permission prompt needs the user gesture.
        const r = await enablePush()
        if (typeof Notification !== 'undefined') onPermission?.(Notification.permission)
        if (!r.ok && r.reason !== 'server-off' && r.reason !== 'unsupported') {
          toast.add({ title: t(pushErrorKey(r.reason === 'error' ? r.code : r.reason)), type: 'danger' })
        }
      } else {
        await disablePush()
      }
    } finally {
      await recheck()
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const { sent } = await sendTestPush()
      toast.add(sent > 0 ? { title: t('settings.push.testSent'), type: 'success' } : { title: t('settings.push.testNone'), type: 'danger' })
    } catch (e) {
      toast.add({ title: t(pushErrorKey(errorCode(e))), type: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return <PushSettingsView state={state} busy={busy} onToggle={(v) => void toggle(v)} onTest={() => void test()} />
}
