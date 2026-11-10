import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminPlayerDetail, AdminPlayerSummary, AdminUnlockField, UserRole } from '../../../../game/protocol'
import { isApiError } from '../../../api'
import { Button, Panel, TextField, toast } from '../../../components'
import { useAuth } from '../../../store/auth'
import { playersApi, type GrantInput } from './api'
import { playersErrorText } from './errors'
import { GrantForm } from './GrantForm'
import { PlayerDetailView } from './PlayerDetail'
import { isStaff } from './permissions'

const MIN_QUERY = 2

export interface PlayersSearchViewProps {
  query: string
  onQuery: (q: string) => void
  onSearch: () => void
  searching: boolean
  results: AdminPlayerSummary[] | null
  selectedId: string | null
  onSelect: (id: string) => void
  error: string | null
}

/** Search box and result list. Presentational. */
export function PlayersSearchView({ query, onQuery, onSearch, searching, results, selectedId, onSelect, error }: PlayersSearchViewProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          onSearch()
        }}
      >
        <TextField
          label={t('admin.players.search')}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('admin.players.searchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          className="flex-1"
          error={error}
        />
        <Button type="submit" icon="search" disabled={searching || query.trim().length < MIN_QUERY} className="mb-6 self-start sm:self-auto">
          {t('admin.players.searchButton')}
        </Button>
      </form>
      {results !== null &&
        (results.length === 0 ? (
          <p className="text-mist-300">{t('admin.players.noResults')}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('admin.players.results')}>
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-pressed={p.id === selectedId}
                  className={`flex w-full flex-wrap items-baseline justify-between gap-x-4 px-3 py-2 text-left inset-shadow-well hover:bg-dusk-950 ${p.id === selectedId ? 'bg-dusk-950' : 'bg-dusk-900'}`}
                >
                  <span className="font-display text-lg">{p.trainerName}</span>
                  <span className="min-w-0 truncate text-mist-300">
                    {p.email} · <span className="font-num">{p.friendCode}</span>
                    {p.role !== 'player' ? ` · ${t(`admin.players.roles.${p.role}`)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

/**
 * Player support (support and admin): search, sheet and actions. The server enforces roles, the sudo mode
 * (grants) and the audit log; this screen only hides what a role cannot do. Renders nothing for players.
 */
export function PlayersPanel() {
  const { t } = useTranslation()
  const me = useAuth((s) => s.user)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AdminPlayerSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminPlayerDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [elevated, setElevated] = useState<boolean | null>(null)
  const [grantError, setGrantError] = useState<string | null>(null)

  if (!me || !isStaff(me.role)) return null
  const role: UserRole = me.role

  const search = async () => {
    const q = query.trim()
    if (q.length < MIN_QUERY) return
    setSearching(true)
    setSearchError(null)
    try {
      setResults((await playersApi.search(q)).items)
    } catch (e) {
      setSearchError(playersErrorText(e))
    } finally {
      setSearching(false)
    }
  }

  const select = async (id: string) => {
    setGrantError(null)
    try {
      setDetail(await playersApi.get(id))
      if (role === 'admin' && elevated === null) setElevated((await playersApi.me()).elevated)
    } catch (e) {
      toast.add({ title: playersErrorText(e), type: 'danger' })
    }
  }

  /** Run one support action and show the refreshed sheet. */
  const run = async (action: () => Promise<AdminPlayerDetail>, done: string) => {
    setBusy(true)
    try {
      setDetail(await action())
      toast.add({ title: t(done), type: 'success' })
    } catch (e) {
      toast.add({ title: playersErrorText(e), type: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const id = detail?.user.id ?? ''
  const unlock = (field: AdminUnlockField) => void run(() => playersApi.unlock(id, field), 'admin.players.unlocked')

  const reauth = async (password: string) => {
    try {
      setElevated((await playersApi.reauth(password)).elevated)
      setGrantError(null)
    } catch (e) {
      setGrantError(playersErrorText(e))
      throw e
    }
  }

  const grant = async (g: GrantInput) => {
    setBusy(true)
    try {
      setDetail(await playersApi.grant(id, g))
      setGrantError(null)
      toast.add({ title: t('admin.players.granted'), type: 'success' })
    } catch (e) {
      // The sudo mode lapsed (30 min): ask for the password again.
      if (isApiError(e) && e.code === 'elevation_required') setElevated(false)
      setGrantError(playersErrorText(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('admin.players.title')}>
      <div className="flex flex-col gap-6">
        <p className="max-w-[60ch] text-mist-300">{t('admin.players.intro')}</p>
        <PlayersSearchView
          query={query}
          onQuery={setQuery}
          onSearch={() => void search()}
          searching={searching}
          results={results}
          selectedId={detail?.user.id ?? null}
          onSelect={(pid) => void select(pid)}
          error={searchError}
        />
        {detail && (
          <PlayerDetailView
            detail={detail}
            me={{ id: me.id, role }}
            busy={busy}
            onUnlock={unlock}
            onCancelSession={(reason) => void run(() => playersApi.cancelSession(id, reason || undefined), 'admin.players.sessionCancelled')}
            onLogoutAll={(reason) => void run(() => playersApi.logoutAll(id, reason || undefined), 'admin.players.loggedOut')}
            grant={<GrantForm onGrant={grant} onReauth={reauth} elevated={elevated === true} error={grantError} busy={busy} />}
          />
        )}
      </div>
    </Panel>
  )
}
