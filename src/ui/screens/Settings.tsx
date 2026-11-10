import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '../../i18n'
import { StageBadge } from '../changelog/StageBadge'
import { APP_VERSION } from '../changelog/release'
import { Button, Dialog, DialogClose, Logo, Panel, Segmented, Select, Slider, Switch, toast } from '../components'
import { hintAnchor, useHintScreen } from '../hints'
import { errorText } from '../lib/errors'
import { allTimeZones } from '../lib/format'
import { sfx } from '../lib/sound'
import { hrefTo } from '../router'
import { useGame } from '../store/game'
import { devEnabled, usePrefs } from '../store/prefs'
import { useServerConfig } from '../store/serverConfig'
import { useBusy, usePlayer } from '../store/selectors'
import { AccountPanel } from './account/AccountPanel'
import { MicSettings } from './MicSettings'
import { PushSettings } from './PushSettings'
import { WeatherSettings } from './WeatherSettings'

// Enforced by the server (src/game/actions.ts TIMEZONE_LOCK_DAYS); shown here.
const TZ_LOCK_DAYS = 30
const DAY = 86_400_000

/** Toast the error of a game action, if any. */
async function report(p: Promise<string | null>) {
  const err = await p
  if (err) toast.add({ title: errorText(err), type: 'danger' })
}

/** Settings: account, language, time zone and weather (location / city), audio, microphone, tips, notifications, reset, about. */
export default function Settings() {
  useHintScreen('settings')
  const { t, i18n } = useTranslation()
  const player = usePlayer()
  const prefs = usePrefs()
  const serverTools = useServerConfig((s) => s.devTools !== false)
  const updateProfile = useGame((s) => s.updateProfile)
  const resetAll = useGame((s) => s.resetAll)
  const busy = useBusy()
  const [confirm, setConfirm] = useState(false)
  const [tzPending, setTzPending] = useState<string | null>(null)
  const zones = useMemo(() => allTimeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [])
  const tz = String(player.profile.timezone)
  const [notif, setNotif] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const a = prefs.audio
  const tzChangedAt = player.profile.timezoneChangedAt ?? null
  const tzUnlockAt = tzChangedAt !== null ? tzChangedAt + TZ_LOCK_DAYS * DAY : 0
  const tzLocked = tzUnlockAt > Date.now() && !devEnabled()

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-3xl">{t('nav.settings')}</h1>

      <AccountPanel />

      <Panel title={t('settings.general')}>
        <div className="flex flex-col gap-6">
          <Row label={t('settings.language')}>
            <Segmented<Locale>
              label={t('settings.language')}
              value={prefs.locale}
              onChange={(l) => {
                prefs.setLocale(l)
                void report(updateProfile({ locale: l }))
              }}
              options={[
                { value: 'es', label: 'Español' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Row>
          <div>
            <Select
              label={t('settings.timezone')}
              options={zones.some((z) => z.value === tz) ? zones : [{ value: tz, label: tz }, ...zones]}
              value={tzPending ?? tz}
              onChange={(v) => v !== tz && setTzPending(v)}
            />
            <p className="mt-2 text-sm text-mist-300">
              {tzLocked
                ? t('settings.tzLocked', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(tzUnlockAt) })
                : t('settings.tzNote', { days: TZ_LOCK_DAYS })}
            </p>
          </div>
          <div>
            <p className="mb-3 font-display text-lg">{t('settings.weather')}</p>
            <WeatherSettings />
          </div>
        </div>
      </Panel>

      <Panel title={t('settings.audio.title')} {...hintAnchor('settings.audio')}>
        <div className="flex flex-col gap-6">
          <Row label={t('settings.audio.mute')} note={t('settings.audio.muteNote')}>
            <Switch checked={a.muted || !a.enabled} onChange={(m) => prefs.setAudio({ muted: m, enabled: true })} label={t('settings.audio.mute')} />
          </Row>
          <VolumeRow label={t('settings.audio.master')} value={a.master} disabled={a.muted} onChange={(v) => prefs.setAudio({ master: v })} onCommit={() => sfx('claim')} />
          <VolumeRow label={t('settings.audio.music')} note={t('settings.audio.musicNote')} value={a.music} disabled={a.muted} onChange={(v) => prefs.setAudio({ music: v })} />
          <VolumeRow label={t('settings.audio.sfx')} note={t('settings.audio.sfxNote')} value={a.sfx} disabled={a.muted} onChange={(v) => prefs.setAudio({ sfx: v })} onCommit={() => sfx('catchSuccess')} />
          <Row label={t('settings.audio.focus')} note={t('settings.audio.focusNote')}>
            <Switch checked={a.musicDuringFocus} onChange={(v) => prefs.setAudio({ musicDuringFocus: v })} label={t('settings.audio.focus')} />
          </Row>
          {a.musicDuringFocus && (
            <>
              <VolumeRow label={t('settings.audio.focusLevel')} note={t('settings.audio.focusLevelNote')} value={a.focusMusicLevel} disabled={a.muted} onChange={(v) => prefs.setAudio({ focusMusicLevel: v })} />
              <Row label={t('settings.audio.background')} note={t('settings.audio.backgroundNote')}>
                <Switch checked={a.backgroundMusic} onChange={(v) => prefs.setAudio({ backgroundMusic: v })} label={t('settings.audio.background')} />
              </Row>
              <Row label={t('settings.audio.hiss')} note={t('settings.audio.hissNote')}>
                <Switch checked={a.vinylHiss} onChange={(v) => prefs.setAudio({ vinylHiss: v })} label={t('settings.audio.hiss')} />
              </Row>
            </>
          )}
          <Row label={t('settings.audio.break')} note={t('settings.audio.breakNote')}>
            <Switch checked={a.musicDuringBreak} onChange={(v) => prefs.setAudio({ musicDuringBreak: v })} label={t('settings.audio.break')} />
          </Row>
        </div>
      </Panel>

      <Panel title={t('mic.settingsTitle')}>
        <MicSettings />
      </Panel>

      <Panel title={t('settings.session')}>
        <div className="flex flex-col gap-6">
          <Row label={t('settings.notifications')} note={t(`settings.notif.${notif}`)}>
            {notif === 'default' && (
              <Button variant="secondary" onClick={() => void Notification.requestPermission().then(setNotif)}>
                {t('settings.notifAsk')}
              </Button>
            )}
          </Row>
          <PushSettings permission={notif} onPermission={setNotif} />
        </div>
      </Panel>

      <Panel title={t('settings.help')}>
        <div className="flex flex-col gap-6">
          <Row label={t('settings.tips')} note={t('settings.tipsNote')}>
            <Switch checked={prefs.tipsEnabled} onChange={(v) => prefs.setTipsEnabled(v)} label={t('settings.tips')} />
          </Row>
          <Row label={t('settings.replay')} note={t('settings.replayNote')}>
            <Button
              variant="secondary"
              onClick={() => {
                prefs.resetHints()
                prefs.setChecklistDismissed(false)
                toast.add({ title: t('settings.replayDone'), type: 'success' })
              }}
            >
              {t('settings.replayButton')}
            </Button>
          </Row>
        </div>
      </Panel>

      <Panel title={t('settings.advanced')}>
        <div className="flex flex-col gap-6">
          <Row label={t('settings.dev')} note={serverTools ? t('settings.devNote') : t('settings.devOffNote')}>
            <Switch checked={prefs.dev.panelOpen} onChange={(v) => prefs.setDev({ panelOpen: v })} label={t('settings.dev')} />
          </Row>
          {/* Wiping the save is a dev tool on the server (DEV_TOOLS=1), so it only shows with dev mode on. */}
          {devEnabled() && (
            <Row label={t('settings.reset')} note={t('settings.resetNote')}>
              <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
                {t('settings.resetButton')}
              </Button>
            </Row>
          )}
        </div>
      </Panel>

      <Panel title={t('settings.about.title')}>
        <div className="flex flex-col gap-3 text-sm text-mist-300">
          <Logo height={32} />
          <p className="max-w-[60ch]">{t('settings.about.body')}</p>
          <p className="max-w-[60ch]">{t('settings.about.credits')}</p>
          <p className="max-w-[60ch] text-mist-400">{t('app.disclaimer')}</p>
          <p className="flex flex-wrap items-center gap-3 font-num text-lg text-mist-400">
            {t('settings.about.version', { version: APP_VERSION })}
            <StageBadge compact />
          </p>
          <a href={hrefTo('changelog')} className="w-fit text-volt-300 underline underline-offset-4 hover:text-volt-200">
            {t('settings.about.changelog')}
          </a>
        </div>
      </Panel>

      <Dialog
        open={tzPending !== null}
        onOpenChange={(o) => !o && setTzPending(null)}
        title={t('settings.tzConfirmTitle')}
        description={tzLocked ? t('settings.tzLocked', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(tzUnlockAt) }) : t('settings.tzConfirmBody', { zone: (tzPending ?? '').replace(/_/g, ' '), days: TZ_LOCK_DAYS })}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button
              disabled={tzLocked || busy}
              onClick={async () => {
                if (tzPending) {
                  const err = await updateProfile({ timezone: tzPending })
                  if (err) toast.add({ title: errorText(err), type: 'danger' })
                  else {
                    toast.add({ title: t('settings.tzDone', { zone: tzPending.replace(/_/g, ' ') }), type: 'success' })
                  }
                }
                setTzPending(null)
              }}
            >
              {t('settings.tzConfirm')}
            </Button>
          </>
        }
      />

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('settings.resetTitle')}
        description={t('settings.resetBody')}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const err = await resetAll()
                if (err) {
                  toast.add({ title: errorText(err), type: 'danger' })
                  setConfirm(false)
                  return
                }
                prefs.resetHints()
                prefs.setChecklistDismissed(false)
                setConfirm(false)
              }}
            >
              {t('settings.resetConfirm')}
            </Button>
          </>
        }
      />
    </div>
  )
}

function Row({ label, note, children }: { label: string; note?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="max-w-[40ch] min-w-0">
        <p className="font-display text-lg">{label}</p>
        {note && <p className="text-sm text-mist-300">{note}</p>}
      </div>
      {children}
    </div>
  )
}

function VolumeRow({ label, note, value, disabled, onChange, onCommit }: { label: string; note?: string; value: number; disabled?: boolean; onChange: (v: number) => void; onCommit?: () => void }) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_18rem] sm:gap-6">
      <div className="min-w-0">
        <p className="font-display text-lg">{label}</p>
        {note && <p className="text-sm text-mist-300">{note}</p>}
      </div>
      <Slider label={label} value={value} onChange={onChange} onCommit={onCommit} disabled={disabled} />
    </div>
  )
}
