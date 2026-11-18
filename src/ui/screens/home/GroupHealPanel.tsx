import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupHealStatus, HealsResponse } from '../../../game/protocol'
import { Panel, PixelIcon, Sprite, toast } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'
import { useAuth } from '../../store/auth'
import { healErrorText, useHeals } from '../../store/heals'

const STATUS_TONE: Record<GroupHealStatus, string> = {
  pending: 'text-amber-400',
  accepted: 'text-volt-400',
  declined: 'text-mist-400',
  cancelled: 'text-mist-400',
  expired: 'text-mist-400',
}

/** The panel: pure, driven by props (so it is testable). */
export function HealPanelView({
  group,
  amount,
  busy,
  onSend,
  onCancel,
}: {
  group: NonNullable<HealsResponse['group']>
  amount: number
  busy: boolean
  onSend: (toUserId: string, uid: string, name: string, speciesSlug: string) => void
  onCancel: (healId: string) => void
}) {
  const { t } = useTranslation()
  const names = useNames()
  if (group.targets.length === 0 && group.sent.length === 0) return null
  return (
    <Panel variant="frame" title={t('heal.panel.title')} aria-label={t('heal.panel.title')}>
      <p className="text-sm text-mist-300">{t('heal.panel.intro', { amount, remaining: group.remaining })}</p>
      {group.remaining === 0 && <p className="mt-1 text-sm text-mist-400">{t('heal.panel.none')}</p>}
      <ul className="mt-3 flex flex-col gap-3">
        {group.targets.map((tg) => (
          <li key={tg.userId} className="bg-dusk-900 p-2 inset-shadow-well">
            <p className="flex items-center gap-2 font-display text-lg">
              <PixelIcon name="friends" size={16} className="text-volt-400" />
              {tg.trainerName}
              {tg.sent && <span className="ml-auto text-sm text-volt-400">{t('heal.panel.sent')}</span>}
            </p>
            {!tg.sent && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {tg.pokemon.map((p) => (
                  <li key={p.uid}>
                    <button
                      type="button"
                      disabled={busy || group.remaining === 0}
                      aria-label={t('heal.panel.pick', { mon: names.species(p.speciesSlug), name: tg.trainerName, amount })}
                      onClick={() => onSend(tg.userId, p.uid, tg.trainerName, p.speciesSlug)}
                      className={cx(
                        'flex min-h-11 items-center gap-1 bg-dusk-700 px-2 py-1 text-sm shadow-frame',
                        'hover:bg-dusk-600 focus-visible:outline-2 focus-visible:outline-volt-400 disabled:opacity-50',
                      )}
                    >
                      <Sprite kind="icon" slug={p.speciesSlug} shiny={p.isShiny} alt="" />
                      <span>{names.species(p.speciesSlug)}</span>
                      <span className="text-mist-400">{t('heal.panel.level', { level: p.level })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {group.sent.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {group.sent.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2">
              <span>{t('heal.panel.row', { name: h.to.trainerName, mon: names.species(h.speciesSlug) })}</span>
              <span className={STATUS_TONE[h.status]}>{t(`heal.status.${h.status}`)}</span>
              {h.status === 'pending' && (
                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto min-h-11 px-2 text-mist-300 underline hover:text-mist-50"
                  onClick={() => onCancel(h.id)}
                >
                  {t('heal.panel.cancel')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * Wave screen, after a study-group session: one heal per wave reached (+N energy
 * for a Pokémon of a different group member each). The server decides what is
 * possible: it returns `group` only on the waves of that session, inside the window.
 */
export function GroupHealPanel() {
  const { t } = useTranslation()
  const names = useNames()
  const authed = useAuth((s) => s.status === 'authed')
  const data = useHeals((s) => s.data)
  const load = useHeals((s) => s.load)
  const send = useHeals((s) => s.send)
  const cancel = useHeals((s) => s.cancel)
  const busy = useHeals((s) => s.busy)
  useEffect(() => {
    if (authed) void load()
  }, [authed, load])
  if (!data?.group) return null
  const group = data.group
  return (
    <HealPanelView
      group={group}
      amount={data.amount}
      busy={busy}
      onSend={async (toUserId, uid, name, slug) => {
        const err = await send(group.id, toUserId, uid)
        if (err) toast.add({ title: healErrorText(err), type: 'danger' })
        else toast.add({ title: t('heal.panel.offered', { name, mon: names.species(slug), amount: data.amount }), type: 'success' })
      }}
      onCancel={async (healId) => {
        const err = await cancel(healId)
        if (err) toast.add({ title: healErrorText(err), type: 'danger' })
      }}
    />
  )
}
