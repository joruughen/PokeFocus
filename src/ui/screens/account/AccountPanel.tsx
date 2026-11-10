import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNTRY_LOCK_DAYS, NAME_LOCK_DAYS, type AuthSessionInfo } from '../../../game/protocol'
import type { ApiError } from '../../api/client'
import { Button, Dialog, DialogClose, IconButton, Panel, PixelIcon, Select, Switch, TextField, toast } from '../../components'
import { hintAnchor } from '../../hints'
import { countryName, countryOptions, flagEmoji } from '../../lib/countries'
import { requestErrorText } from '../../lib/errors'
import { checkPassword, checkTrainerName, PASSWORD_MAX, PASSWORD_MIN, TRAINER_MAX } from '../../lib/validation'
import { isAccountLockError, useAuth } from '../../store/auth'
import { devEnabled } from '../../store/prefs'
import { lockState, profileChange, serverUnlockAt, type ProfileChange } from './accountLocks'

/**
 * Settings → Account: email, trainer name and country (PATCH /auth/me; each
 * locked for 30 days after a change, with a confirm before saving), the
 * "anonymous in the rankings" privacy switch, password change, the list of
 * signed-in devices (revoke one, or all) and sign out.
 */
export function AccountPanel() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const [confirmAll, setConfirmAll] = useState(false)
  if (!user) return null
  return (
    <Panel title={t('account.title')} help="settings.account" {...hintAnchor('settings.account')}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-lg">{t('account.email')}</p>
            <p className="truncate text-mist-300">{user.email}</p>
          </div>
          <Button variant="secondary" icon="logout" onClick={() => void logout()}>
            {t('account.logout')}
          </Button>
        </div>

        <ProfileForm />
        <PrivacyForm />
        <PasswordForm />
        <Sessions onLogoutAll={() => setConfirmAll(true)} />
      </div>
      <LogoutAllDialog open={confirmAll} onOpenChange={setConfirmAll} />
    </Panel>
  )
}

function ProfileForm() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const user = useAuth((s) => s.user)!
  const updateMe = useAuth((s) => s.updateMe)
  const [name, setName] = useState(user.trainerName)
  const [country, setCountry] = useState(user.country)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<ProfileChange | null>(null)
  const countries = useMemo(() => countryOptions(lng), [lng])
  const now = Date.now()
  const dev = devEnabled()
  const nameLock = lockState(user.nameChangedAt, NAME_LOCK_DAYS, now, dev)
  const countryLock = lockState(user.countryChangedAt, COUNTRY_LOCK_DAYS, now, dev)
  const nameErr = nameLock.locked ? null : checkTrainerName(name)
  // Only what really changes counts (a locked field cannot be edited; the same value is a no-op).
  const change = profileChange(user, { name, country }, { name: nameLock.locked, country: countryLock.locked })
  const dirty = change !== null
  const dateOf = (at: number) => new Intl.DateTimeFormat(lng, { dateStyle: 'long' }).format(at)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || nameErr || !change) return
    setError(null)
    // A real change locks the field for 30 days, so ask first (the same value is a no-op and never gets here).
    setPending(change)
  }

  const save = async (change: ProfileChange) => {
    setPending(null)
    setBusy(true)
    setError(null)
    try {
      const saved = await updateMe(change)
      setName(saved.trainerName)
      setCountry(saved.country)
      toast.add({ title: t('account.profileSaved'), type: 'success' })
    } catch (err) {
      if (isAccountLockError(err)) lockedMeanwhile(err)
      else setError(requestErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  /** The server says a field is still locked (stale clock or state): the store already refreshed the user. */
  const lockedMeanwhile = (err: ApiError) => {
    const fresh = useAuth.getState().user
    const isName = err.code === 'name_locked'
    // The server's own `unlockAt` first; the refreshed user (changedAt + lock days) is the fallback.
    const computed = isName ? lockState(fresh?.nameChangedAt ?? null, NAME_LOCK_DAYS, Date.now(), false) : lockState(fresh?.countryChangedAt ?? null, COUNTRY_LOCK_DAYS, Date.now(), false)
    const lock = { unlockAt: serverUnlockAt(err.body) ?? computed.unlockAt }
    if (fresh) {
      if (isName) setName(fresh.trainerName)
      else setCountry(fresh.country)
    }
    toast.add({
      title: t(isName ? 'account.nameStillLocked' : 'account.countryStillLocked'),
      description: lock.unlockAt !== null && lock.unlockAt > Date.now() ? t('account.lockedUntil', { date: dateOf(lock.unlockAt) }) : requestErrorText(err),
      type: 'danger',
    })
  }

  return (
    <>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="acc-profile">
        <h3 id="acc-profile" className="text-lg">
          {t('account.profile')}
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={t('auth.trainerName')}
            value={nameLock.locked ? user.trainerName : name}
            maxLength={TRAINER_MAX}
            autoComplete="nickname"
            disabled={nameLock.locked}
            onChange={(e) => setName(e.target.value)}
            error={nameErr && name !== user.trainerName ? t(nameErr) : null}
            hint={
              nameLock.locked && nameLock.unlockAt !== null
                ? t('account.lockedUntil', { date: dateOf(nameLock.unlockAt) })
                : `${t('account.nameHint')} ${t('account.lockHint', { days: NAME_LOCK_DAYS })}`
            }
          />
          {countryLock.locked && countryLock.unlockAt !== null ? (
            <TextField
              label={t('auth.country')}
              value={`${flagEmoji(user.country)} ${countryName(user.country, lng)}`}
              readOnly
              disabled
              hint={t('account.lockedUntil', { date: dateOf(countryLock.unlockAt) })}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Select label={t('auth.country')} options={countries} value={country} onChange={setCountry} />
              <p className="text-sm text-mist-400">{t('account.lockHint', { days: COUNTRY_LOCK_DAYS })}</p>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="bg-dusk-900 p-3 text-cheek-400 inset-shadow-well">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy || !dirty || Boolean(nameErr)}>
            {t('account.save')}
          </Button>
        </div>
      </form>
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('account.confirmTitle')}
        description={
          pending && (
            <span className="flex flex-col gap-2">
              {pending.trainerName !== undefined && <span>{t('account.confirmName', { name: pending.trainerName, days: NAME_LOCK_DAYS })}</span>}
              {pending.country !== undefined && <span>{t('account.confirmCountry', { country: countryName(pending.country, lng), days: COUNTRY_LOCK_DAYS })}</span>}
            </span>
          )
        }
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button disabled={busy} onClick={() => pending && void save(pending)}>
              {t('account.confirmSave')}
            </Button>
          </>
        }
      />
    </>
  )
}

/** Privacy: hide my name from the global and country leaderboards (saved right away, no lock). */
function PrivacyForm() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)!
  const updateMe = useAuth((s) => s.updateMe)
  // The value being saved, shown at once; null when nothing is in flight (then the account's value shows).
  const [saving, setSaving] = useState<boolean | null>(null)
  const checked = saving ?? user.anonymousRankings

  const change = async (value: boolean) => {
    setSaving(value)
    try {
      await updateMe({ anonymousRankings: value })
      toast.add({ title: t(value ? 'account.anonymousOn' : 'account.anonymousOff'), type: 'success' })
    } catch (err) {
      toast.add({ title: requestErrorText(err), type: 'danger' })
    } finally {
      setSaving(null) // success: the new user already holds the value; failure: back to the old one.
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="acc-privacy">
      <h3 id="acc-privacy" className="text-lg">
        {t('account.privacy')}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[44ch] min-w-0">
          <p className="font-display text-lg">{t('account.anonymous')}</p>
          <p className="text-sm text-mist-300">{t('account.anonymousHint')}</p>
        </div>
        <Switch checked={checked} onChange={(v) => void change(v)} label={t('account.anonymous')} disabled={saving !== null} />
      </div>
    </section>
  )
}

function PasswordForm() {
  const { t } = useTranslation()
  const changePassword = useAuth((s) => s.changePassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextErr = checkPassword(next) ?? (next && next === current ? 'account.samePassword' : null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!current || nextErr) return
    setBusy(true)
    setError(null)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setTried(false)
      toast.add({ title: t('account.passwordChanged'), description: t('account.passwordChangedBody'), type: 'success' })
    } catch (err) {
      setError(requestErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="acc-pass">
      <h3 id="acc-pass" className="text-lg">
        {t('account.password')}
      </h3>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={t('account.currentPassword')}
          revealable
          autoComplete="current-password"
          value={current}
          maxLength={PASSWORD_MAX}
          onChange={(e) => setCurrent(e.target.value)}
          error={tried && !current ? t('auth.invalid.passwordEmpty') : null}
        />
        <TextField
          label={t('account.newPassword')}
          revealable
          autoComplete="new-password"
          value={next}
          maxLength={PASSWORD_MAX}
          onChange={(e) => setNext(e.target.value)}
          error={(tried || next.length > 0) && nextErr && (tried || next.length >= PASSWORD_MIN) ? t(nextErr, { min: PASSWORD_MIN, max: PASSWORD_MAX }) : null}
          hint={t('auth.passwordHint', { min: PASSWORD_MIN })}
        />
      </div>
      {error && (
        <p role="alert" className="bg-dusk-900 p-3 text-cheek-400 inset-shadow-well">
          {error}
        </p>
      )}
      <p className="max-w-[60ch] text-sm text-mist-400">{t('account.passwordNote')}</p>
      <div>
        <Button type="submit" variant="secondary" icon="lock" disabled={busy}>
          {t('account.changePassword')}
        </Button>
      </div>
    </form>
  )
}

function Sessions({ onLogoutAll }: { onLogoutAll: () => void }) {
  const { t, i18n } = useTranslation()
  const listSessions = useAuth((s) => s.listSessions)
  const revokeSession = useAuth((s) => s.revokeSession)
  const [sessions, setSessions] = useState<AuthSessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions())
      setError(null)
    } catch (err) {
      setError(requestErrorText(err))
    }
  }, [listSessions])
  useEffect(() => {
    void load()
  }, [load])

  const revoke = async (s: AuthSessionInfo) => {
    setBusyId(s.id)
    try {
      await revokeSession(s.id)
      toast.add({ title: t('account.revoked', { device: deviceName(s.userAgent, t) }), type: 'success' })
      await load()
    } catch (err) {
      toast.add({ title: requestErrorText(err), type: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const sorted = sessions ? [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt) : null
  return (
    <section className="flex flex-col gap-3" aria-labelledby="acc-sessions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="acc-sessions" className="text-lg">
          {t('account.sessions')}
        </h3>
        <Button size="sm" variant="ghost" icon="logout" onClick={onLogoutAll}>
          {t('account.logoutAll')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-cheek-400">
          {error}
        </p>
      )}
      {!sorted ? (
        !error && (
          <p role="status" className="text-sm text-mist-400">
            {t('common.loading')}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((s) => (
            <li key={s.id} className="flex items-center gap-3 bg-dusk-900 p-3 inset-shadow-well">
              <PixelIcon name={s.current ? 'check' : 'user'} size={20} className={s.current ? 'shrink-0 text-leaf-400' : 'shrink-0 text-mist-400'} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base">
                  {deviceName(s.userAgent, t)}
                  {s.current && <span className="ml-2 bg-leaf-400 px-1.5 py-0.5 text-sm text-ink">{t('account.thisDevice')}</span>}
                </p>
                <p className="text-xs text-mist-400">
                  {t('account.lastSeen', { when: relativeTime(s.lastSeenAt, i18n.language) })} {t('account.since', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(s.createdAt) })}
                </p>
              </div>
              {!s.current && (
                <IconButton icon="close" size="sm" variant="ghost" label={t('account.revoke', { device: deviceName(s.userAgent, t) })} disabled={busyId === s.id} onClick={() => void revoke(s)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LogoutAllDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const logoutAll = useAuth((s) => s.logoutAll)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('account.logoutAllTitle')}
      description={t('account.logoutAllBody')}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
          <Button
            variant="danger"
            icon="logout"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await logoutAll()
              } catch (err) {
                toast.add({ title: requestErrorText(err), type: 'danger' })
                setBusy(false)
              }
            }}
          >
            {t('account.logoutAllConfirm')}
          </Button>
        </>
      }
    />
  )
}

/** "Chrome · Windows"-style label from a user agent, without a parsing library. */
function deviceName(ua: string | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!ua) return t('account.unknownDevice')
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null
  if (browser && os) return t('account.device', { browser, os })
  return browser ?? os ?? t('account.unknownDevice')
}

function relativeTime(at: number, lng: string): string {
  const diff = at - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' })
  if (abs < 60_000) return rtf.format(0, 'second')
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  return rtf.format(Math.round(diff / 86_400_000), 'day')
}
