import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupHealView } from '../game/protocol'
import { Button, PixelIcon, Sprite, toast } from './components'
import { useNames } from './lib/names'
import { useAuth } from './store/auth'
import { useGame } from './store/game'
import { healErrorText, useHeals } from './store/heals'

/** The cards: pure, driven by props (so they are testable). */
export function HealNoticeList({
  heals,
  studying,
  busy,
  onAccept,
  onDecline,
}: {
  heals: GroupHealView[]
  studying: boolean
  busy: boolean
  onAccept: (h: GroupHealView) => void
  onDecline: (h: GroupHealView) => void
}) {
  const { t } = useTranslation()
  const names = useNames()
  if (heals.length === 0) return null
  return (
    <aside aria-label={t('heal.incoming.label')} className="fixed top-3 right-3 left-3 z-30 flex flex-col gap-2 sm:left-auto sm:w-96">
      {heals.slice(0, 3).map((h) => (
        <section key={h.id} role="status" className="bg-dusk-700 p-3 text-mist-50 shadow-plate">
          <p className="flex items-start gap-2 font-display text-lg leading-tight">
            <Sprite kind="icon" slug={h.speciesSlug} alt="" className="mt-0.5 shrink-0" />
            <span>{t('heal.incoming.title', { name: h.from.trainerName, mon: names.species(h.speciesSlug), amount: h.amount })}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-mist-300">
            <PixelIcon name="heart" size={14} className="shrink-0 text-volt-400" />
            {studying ? t('heal.incoming.afterSession') : t('heal.incoming.body', { amount: h.amount })}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" icon="check" disabled={busy || studying} onClick={() => onAccept(h)}>
              {t('heal.incoming.accept')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecline(h)}>
              {t('heal.incoming.decline')}
            </Button>
          </div>
        </section>
      ))}
    </aside>
  )
}

/**
 * Study-group heals sent to me, on every screen (they arrive over SSE). Accepting
 * is possible once my own session is over: the Pokémon of a running session keeps
 * the energy the session simulates.
 */
export function GroupHealNotice() {
  const { t } = useTranslation()
  const names = useNames()
  const authed = useAuth((s) => s.status === 'authed')
  const data = useHeals((s) => s.data)
  const load = useHeals((s) => s.load)
  const accept = useHeals((s) => s.accept)
  const decline = useHeals((s) => s.decline)
  const busy = useHeals((s) => s.busy)
  const studying = useGame((s) => Boolean(s.player?.activeSession))
  useEffect(() => {
    if (authed && !data) void load()
  }, [authed, data, load])
  return (
    <HealNoticeList
      heals={data?.incoming ?? []}
      studying={studying}
      busy={busy}
      onAccept={async (h) => {
        const err = await accept(h.id)
        if (err) toast.add({ title: healErrorText(err), type: 'danger' })
        else toast.add({ title: t('heal.incoming.done', { mon: names.species(h.speciesSlug), amount: h.amount }), type: 'success' })
      }}
      onDecline={async (h) => {
        const err = await decline(h.id)
        if (err) toast.add({ title: healErrorText(err), type: 'danger' })
      }}
    />
  )
}
