import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminEvent } from '../../../../game/protocol'
import { Button, Panel } from '../../../components'
import { onServerEvent } from '../../../api'
import { cx } from '../../../lib/cx'
import { asLocale } from '../../../lib/names'
import { eventText, formatEventWhen } from '../../events/model'
import { eventsAdminApi } from './api'
import type { EventDraft, EventGroup } from './draft'
import { eventGroup } from './draft'
import { EventEditor } from './EventEditor'
import { eventsErrorText } from './errors'
import { EventImportDialog, type EventImported } from '../import/EventImportDialog'
import type { ImportInfo } from '../import/logic'

const GROUPS: EventGroup[] = ['active', 'scheduled', 'draft', 'past']

/** Order inside a group: running and scheduled by start, drafts by last edit, past ones newest first. */
export function groupEvents(items: readonly AdminEvent[]): Record<EventGroup, AdminEvent[]> {
  const out: Record<EventGroup, AdminEvent[]> = { active: [], scheduled: [], draft: [], past: [] }
  for (const e of items) out[eventGroup(e)].push(e)
  out.active.sort((a, b) => a.startsAt - b.startsAt)
  out.scheduled.sort((a, b) => a.startsAt - b.startsAt)
  out.draft.sort((a, b) => b.updatedAt - a.updatedAt)
  out.past.sort((a, b) => b.endsAt - a.endsAt)
  return out
}

/** `key` stays the same while one form is open (a new event keeps its form after its first save). */
type Selection = { kind: 'none' } | { kind: 'edit'; key: string; event: AdminEvent | null; seed: EventDraft | null; prefill?: EventDraft | null; info?: ImportInfo | null }

/**
 * Events tab of the admin screen (`#/admin`): the list of events by state and the editor. Needs the admin
 * role (the server answers 403 to anyone else); the sensitive actions ask for the password again.
 */
export default function EventsAdminPanel() {
  const [items, setItems] = useState<AdminEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection>({ kind: 'none' })
  const [elevated, setElevated] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems((await eventsAdminApi.list()).items)
      setError(null)
    } catch (e) {
      setError(eventsErrorText(e))
    }
  }, [])

  useEffect(() => {
    void load()
    void eventsAdminApi
      .me()
      .then((me) => setElevated(me.elevated))
      .catch(() => undefined)
    // An event starting or ending (or another admin editing) moves the content hash: refresh the list.
    return onServerEvent((e) => {
      if ((e as { type?: string }).type === 'content') void load()
    })
  }, [load])

  const upsert = (ev: AdminEvent) => setItems((cur) => (cur ? (cur.some((x) => x.id === ev.id) ? cur.map((x) => (x.id === ev.id ? ev : x)) : [ev, ...cur]) : [ev]))

  if (sel.kind === 'edit') {
    return (
      <EventEditor
        key={sel.key}
        event={sel.event}
        seed={sel.seed}
        prefill={sel.prefill}
        importInfo={sel.info}
        elevated={elevated}
        onElevated={setElevated}
        onSaved={upsert}
        onDeleted={(id) => {
          setItems((cur) => cur?.filter((x) => x.id !== id) ?? null)
          setSel({ kind: 'none' })
        }}
        onBack={() => {
          setSel({ kind: 'none' })
          void load()
        }}
        onDuplicate={(seed) => setSel({ kind: 'edit', key: `new-${Date.now()}`, event: null, seed })}
      />
    )
  }

  /** An import became a draft: the editor opens with the imported fields unsaved (on a new event, or on the draft it updates). */
  const imported = ({ draft, target, info }: EventImported) =>
    setSel(
      target
        ? { kind: 'edit', key: `${target.id}-import-${Date.now()}`, event: target, seed: null, prefill: draft, info }
        : { kind: 'edit', key: `new-${Date.now()}`, event: null, seed: null, prefill: draft, info },
    )

  return (
    <>
      <EventsList
        items={items}
        error={error}
        onRetry={() => void load()}
        onNew={() => setSel({ kind: 'edit', key: `new-${Date.now()}`, event: null, seed: null })}
        onImport={items ? () => setImporting(true) : undefined}
        onOpen={(ev) => setSel({ kind: 'edit', key: ev.id, event: ev, seed: null })}
      />
      <EventImportDialog open={importing} onOpenChange={setImporting} mode="list" events={items ?? []} onImported={imported} />
    </>
  )
}

export interface EventsListProps {
  items: AdminEvent[] | null
  error: string | null
  onRetry: () => void
  onNew: () => void
  /** Open the JSON import (absent while the list is loading). */
  onImport?: () => void
  onOpen: (e: AdminEvent) => void
}

/** The events by state (running, scheduled, drafts, past), each one a button that opens the editor. */
export function EventsList({ items, error, onRetry, onNew, onImport, onOpen }: EventsListProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const grouped = useMemo(() => (items ? groupEvents(items) : null), [items])
  return (
    <Panel
      title={t('eventsAdmin.list.title')}
      actions={
        <>
          {onImport && (
            <Button size="sm" variant="secondary" icon="plus" onClick={onImport}>
              {t('adminJson.import.button')}
            </Button>
          )}
          <Button size="sm" icon="plus" onClick={onNew}>
            {t('eventsAdmin.list.new')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-mist-300">{t('eventsAdmin.list.intro')}</p>
        {error && (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-cheek-400">{error}</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('eventsAdmin.list.retry')}
            </Button>
          </div>
        )}
        {!grouped && !error && <p className="text-mist-400">{t('common.loading')}</p>}
        {grouped && items?.length === 0 && <p className="text-mist-300">{t('eventsAdmin.list.empty')}</p>}
        {grouped &&
          GROUPS.filter((g) => grouped[g].length > 0).map((g) => (
            <section key={g} aria-labelledby={`ev-group-${g}`} className="flex flex-col gap-2">
              <h3 id={`ev-group-${g}`} className="text-lg">
                {t(`eventsAdmin.list.groups.${g}`)} <span className="text-sm text-mist-400">({grouped[g].length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {grouped[g].map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      className="flex w-full items-center gap-3 bg-dusk-900 p-3 text-left inset-shadow-well hover:bg-dusk-950 focus-visible:outline-2 focus-visible:outline-volt-400"
                    >
                      {e.image ? <img src={e.image.thumbUrl} alt="" loading="lazy" className="aspect-video w-20 shrink-0 object-cover" /> : <span aria-hidden className="aspect-video w-20 shrink-0 bg-dusk-700" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-lg leading-tight">{eventText(e.name, lng)}</span>
                        <span className="block text-sm break-words text-mist-300">
                          {formatEventWhen(e.startsAt, undefined, i18n.language)} – {formatEventWhen(e.endsAt, undefined, i18n.language)}
                        </span>
                        <span className="block font-num text-sm text-mist-400">{e.slug}</span>
                      </span>
                      <span className={cx('shrink-0 px-1.5 pt-0.5 font-display text-sm leading-tight uppercase', STATUS_BADGE[eventGroup(e)])}>{t(`eventsAdmin.list.badge.${eventGroup(e) === 'past' ? e.status : eventGroup(e)}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </Panel>
  )
}

const STATUS_BADGE: Record<EventGroup, string> = {
  active: 'bg-volt-400 text-ink',
  scheduled: 'bg-amber-400 text-ink',
  draft: 'bg-dusk-600 text-mist-100',
  past: 'bg-dusk-700 text-mist-300',
}
