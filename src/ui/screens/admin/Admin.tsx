import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAINTENANCE_MAX_MS, MAINTENANCE_NOTE_MAX, type AdminMaintenanceItem } from '../../../game/protocol'
import { adminApi, isApiError } from '../../api'
import { Button, IconButton, Panel, TextField, toast } from '../../components'
import { errorText } from '../../lib/errors'
import { browserTimeZone } from '../../lib/format'
import { formatWindow, fromLocalInput, toLocalInput } from '../../lib/maintenance'
import { MaintenanceNoticeBar } from '../../MaintenanceBanner'
import { useAnnouncements } from '../../store/announcements'
import { useAuth } from '../../store/auth'
import { PlayersPanel } from './players/PlayersPanel'

const TOKEN_KEY = 'pokefocus:adminToken'
const HOUR = 3_600_000

/** The token lives in sessionStorage only: it disappears when the tab closes. */
function loadToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // private mode: the token just stays in memory
  }
}

function adminErrorText(e: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return t('admin.errors.rate_limited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  if (['admin_disabled', 'unauthorized', 'too_many', 'invalid_body'].includes(e.code)) return t(`admin.errors.${e.code}`)
  return errorText(e.code)
}

/** Next full hour, so a default window looks like "tonight 02:00 – 03:00". */
function nextHour(now: number): number {
  return Math.ceil((now + 60_000) / HOUR) * HOUR
}

/**
 * Admin (`#/admin`, not in the menu): schedule and remove maintenance notices.
 * Guarded by the account role (admin) or, as a deprecated fallback, the server's ADMIN_TOKEN. The notice
 * only informs players (a banner); it does not stop the server.
 */
export default function Admin() {
  const { t } = useTranslation()
  const isAdmin = useAuth((s) => s.user?.role === 'admin')
  const [token, setToken] = useState(loadToken)
  const [unlocked, setUnlocked] = useState(false)
  const [items, setItems] = useState<AdminMaintenanceItem[]>([])
  const [authError, setAuthError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const unlock = async (candidate: string) => {
    setChecking(true)
    setAuthError(null)
    try {
      const res = await adminApi.list(candidate)
      setItems(res.items)
      setToken(candidate)
      saveToken(candidate)
      setUnlocked(true)
    } catch (e) {
      setUnlocked(false)
      if (isApiError(e) && e.code === 'unauthorized') saveToken(null)
      setAuthError(adminErrorText(e, t))
    } finally {
      setChecking(false)
    }
  }

  // An admin account uses its own session (no token); otherwise try a token kept
  // from earlier in this tab straight away.
  useEffect(() => {
    if (isAdmin) {
      void unlock('')
      return
    }
    const saved = loadToken()
    if (saved) void unlock(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  const lock = () => {
    saveToken(null)
    setToken('')
    setUnlocked(false)
    setItems([])
  }

  /** Refresh the banner people see right now (the admin is a player too). */
  const refreshPublic = () => void useAnnouncements.getState().load()

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">{t('admin.title')}</h1>
        <p className="max-w-[60ch] text-mist-300">{t('admin.intro')}</p>
      </header>

      <PlayersPanel />

      {!unlocked ? (
        <Panel title={t('admin.access.title')}>
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (token.trim()) void unlock(token.trim())
            }}
          >
            <p className="text-mist-300">{t('admin.access.body')}</p>
            <TextField
              label={t('admin.access.token')}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              revealable
              autoComplete="off"
              spellCheck={false}
              error={authError}
            />
            <Button type="submit" disabled={checking || !token.trim()} className="self-start">
              {t('admin.access.unlock')}
            </Button>
          </form>
        </Panel>
      ) : (
        <>
          <MaintenanceForm
            token={token}
            onCreated={(item) => {
              setItems((cur) => [...cur, item].sort((a, b) => a.startsAt - b.startsAt))
              refreshPublic()
            }}
            onAuthLost={lock}
          />
          <MaintenanceList
            items={items}
            token={token}
            onRemoved={(id) => {
              setItems((cur) => cur.filter((i) => i.id !== id))
              refreshPublic()
            }}
            onAuthLost={lock}
          />
          <div>
            <Button variant="ghost" size="sm" icon="logout" onClick={lock}>
              {t('admin.access.lock')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function MaintenanceForm({ token, onCreated, onAuthLost }: { token: string; onCreated: (item: AdminMaintenanceItem) => void; onAuthLost: () => void }) {
  const { t, i18n } = useTranslation()
  const [start, setStart] = useState(() => toLocalInput(nextHour(Date.now())))
  const [end, setEnd] = useState(() => toLocalInput(nextHour(Date.now()) + HOUR))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startsAt = fromLocalInput(start)
  const endsAt = fromLocalInput(end)
  const problem = useMemo(() => {
    if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return 'invalidDate'
    if (endsAt <= startsAt) return 'endBeforeStart'
    if (endsAt <= Date.now()) return 'endInPast'
    if (endsAt - startsAt > MAINTENANCE_MAX_MS) return 'tooLong'
    return null
  }, [startsAt, endsAt])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem || busy) return
    setBusy(true)
    setError(null)
    try {
      const { item } = await adminApi.create(token, { startsAt, endsAt, note: note.trim() || null })
      onCreated(item)
      setNote('')
      toast.add({ title: t('admin.form.published'), description: formatWindow(item.startsAt, item.endsAt, i18n.language), type: 'success' })
    } catch (err) {
      if (isApiError(err) && err.code === 'unauthorized') onAuthLost()
      setError(adminErrorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const preview = !problem ? { notice: { id: 'preview', startsAt, endsAt, note: note.trim() || null }, phase: startsAt <= Date.now() ? ('active' as const) : ('upcoming' as const) } : null

  return (
    <Panel title={t('admin.form.title')}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('admin.form.start')} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          <TextField label={t('admin.form.end')} type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <p className="-mt-2 text-sm text-mist-400">{t('admin.form.zone', { zone: browserTimeZone() })}</p>
        <TextField
          label={t('admin.form.note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAINTENANCE_NOTE_MAX}
          hint={t('admin.form.noteHint', { count: note.length, max: MAINTENANCE_NOTE_MAX })}
        />
        {preview && (
          <div className="flex flex-col gap-2">
            <p className="font-display text-base text-mist-300">{t('admin.form.preview')}</p>
            <MaintenanceNoticeBar view={preview} now={Date.now()} />
          </div>
        )}
        <p className="min-h-5 text-sm text-cheek-400" role="alert">
          {error ?? (problem && start && end ? t(`admin.errors.${problem}`) : null)}
        </p>
        <p className="text-sm text-mist-400">{t('admin.form.info')}</p>
        <Button type="submit" icon="check" disabled={busy || problem !== null} className="self-start">
          {t('admin.form.publish')}
        </Button>
      </form>
    </Panel>
  )
}

function MaintenanceList({ items, token, onRemoved, onAuthLost }: { items: AdminMaintenanceItem[]; token: string; onRemoved: (id: string) => void; onAuthLost: () => void }) {
  const { t, i18n } = useTranslation()
  const [removing, setRemoving] = useState<string | null>(null)

  const remove = async (item: AdminMaintenanceItem) => {
    setRemoving(item.id)
    try {
      await adminApi.remove(token, item.id)
      onRemoved(item.id)
      toast.add({ title: t('admin.list.removed'), type: 'success' })
    } catch (err) {
      if (isApiError(err) && err.code === 'unauthorized') onAuthLost()
      // Already gone (another admin tab): just drop it from the list.
      else if (isApiError(err) && err.status === 404) onRemoved(item.id)
      else toast.add({ title: adminErrorText(err, t), type: 'danger' })
    } finally {
      setRemoving(null)
    }
  }

  const now = Date.now()
  return (
    <Panel title={t('admin.list.title')}>
      {items.length === 0 ? (
        <p className="text-mist-300">{t('admin.list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const when = formatWindow(item.startsAt, item.endsAt, i18n.language)
            const active = item.startsAt <= now
            return (
              <li key={item.id} className="flex items-start gap-3 bg-dusk-900 p-3 inset-shadow-well">
                <span className={`mt-0.5 shrink-0 px-1.5 pt-0.5 font-display text-sm leading-tight uppercase ${active ? 'bg-cheek-500 text-mist-50' : 'bg-amber-400 text-ink'}`}>
                  {t(active ? 'admin.list.active' : 'admin.list.upcoming')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-num text-xl leading-tight">{when}</p>
                  {item.note && <p className="mt-1 break-words text-mist-300">{item.note}</p>}
                </div>
                <IconButton icon="trash" size="sm" variant="ghost" label={t('admin.list.remove', { when })} disabled={removing === item.id} onClick={() => void remove(item)} />
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
