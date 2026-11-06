import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MINUTE_MS } from '../engine'
import { Button, PixelIcon, toast } from './components'
import { useNow } from './store/clock'
import { useGame } from './store/game'
import { groupErrorText, useGroups } from './store/group'

/**
 * Incoming study-group invites, on every screen (they arrive over SSE).
 * Accepting a lobby waits for the host; accepting a started group joins late
 * (your session starts now, with less accompanied time).
 */
export function GroupInviteNotice() {
  const { t } = useTranslation()
  const now = useNow()
  const invites = useGroups((s) => s.invites)
  const loaded = useGroups((s) => s.loaded)
  const load = useGroups((s) => s.load)
  const accept = useGroups((s) => s.accept)
  const decline = useGroups((s) => s.decline)
  const busy = useGroups((s) => s.busy)
  const studying = useGame((s) => Boolean(s.player?.activeSession))
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  if (invites.length === 0) return null
  return (
    <aside aria-label={t('group.invites.label')} className="fixed top-3 right-3 left-3 z-40 flex flex-col gap-2 sm:left-auto sm:w-96">
      {invites.slice(0, 3).map((g) => {
        const started = g.status === 'started'
        const left = Math.max(0, Math.ceil((g.expiresAt - now) / MINUTE_MS))
        return (
          <section key={g.id} role="status" className="bg-dusk-700 p-3 text-mist-50 shadow-plate">
            <p className="flex items-start gap-2 font-display text-lg leading-tight">
              <PixelIcon name="friends" size={20} className="mt-0.5 shrink-0 text-volt-400" />
              <span>{t('group.invites.title', { name: g.hostName, minutes: g.minutes })}</span>
            </p>
            <p className="mt-1 text-sm text-mist-300">
              {started ? t('group.invites.lateJoin') : t('group.invites.lobby', { count: left })} {t('group.invites.fairy')}
            </p>
            {studying && <p className="mt-1 text-sm text-amber-400">{t('group.invites.busy')}</p>}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                icon={started ? 'play' : 'check'}
                disabled={busy || studying}
                onClick={async () => {
                  const err = await accept(g.id)
                  if (err) toast.add({ title: groupErrorText(err), type: 'danger' })
                  else toast.add({ title: started ? t('group.invites.joined') : t('group.invites.accepted', { name: g.hostName }), type: 'success' })
                }}
              >
                {started ? t('group.invites.join') : t('group.invites.accept')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  const err = await decline(g.id)
                  if (err) toast.add({ title: groupErrorText(err), type: 'danger' })
                }}
              >
                {t('group.invites.decline')}
              </Button>
            </div>
          </section>
        )
      })}
    </aside>
  )
}
