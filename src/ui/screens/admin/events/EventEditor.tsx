import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, MISSION_KINDS, type MissionKind } from '../../../../engine'
import type { AdminEvent } from '../../../../game/protocol'
import { Button, Dialog, DialogClose, IconButton, Panel, Select, Switch, TextField } from '../../../components'
import { isApiError } from '../../../api'
import { cx } from '../../../lib/cx'
import { browserTimeZone } from '../../../lib/format'
import { fromLocalInput } from '../../../lib/maintenance'
import { asLocale, typeName } from '../../../lib/names'
import { useNow } from '../../../store/clock'
import { EventCard } from '../../events/EventCard'
import { eventsAdminApi } from './api'
import {
  blankDraft,
  blankMission,
  draftFromEvent,
  draftToBody,
  draftToOverlayInput,
  draftToPublic,
  sameDraft,
  slugify,
  type DraftMission,
  type DraftProblem,
  type EventDraft,
  type EventRequestBody,
} from './draft'
import { eventsErrorText, issuesOf, issueText, type IssueLike } from './errors'
import { EventDatalists, ItemInput, Row, RowList, SpeciesInput, TextArea } from './fields'
import { ImagePicker } from './ImagePicker'
import { SpawnPreview } from './SpawnPreview'
import { SudoDialog, type SudoMode, type SudoSubmit } from './SudoDialog'

export interface EventEditorProps {
  /** The saved event to edit; null = a new one. */
  event: AdminEvent | null
  /** Start a new event from this form (Duplicate). */
  seed?: EventDraft | null
  elevated: boolean
  onElevated: (v: boolean) => void
  /** After every successful save, publish, archive. */
  onSaved: (e: AdminEvent) => void
  onDeleted: (id: string) => void
  onBack: () => void
  onDuplicate: (d: EventDraft) => void
}

interface LocalValidation {
  errors: IssueLike[]
  warnings: IssueLike[]
  requiresConfirm: boolean
}

const utc = (ts: number): string => (Number.isNaN(ts) ? '' : `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC`)

/** The form of one event: everything the overlay can hold, live validation, a player's-eye preview, and the publish flow. */
export function EventEditor({ event, seed, elevated, onElevated, onSaved, onDeleted, onBack, onDuplicate }: EventEditorProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const now = useNow()
  const [saved, setSaved] = useState<EventDraft>(() => (event ? draftFromEvent(event) : (seed ?? blankDraft(Date.now()))))
  const [d, setD] = useState<EventDraft>(saved)
  const [current, setCurrent] = useState<AdminEvent | null>(event)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<DraftProblem[]>([])
  const [local, setLocal] = useState<LocalValidation | null>(null)
  const [serverIssues, setServerIssues] = useState<{ errors: IssueLike[]; warnings: IssueLike[] } | null>(null)
  const [dialog, setDialog] = useState<SudoMode | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [serverRisky, setServerRisky] = useState<IssueLike[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const locked = d.status === 'archived'
  const published = d.status === 'published'
  const dirty = !sameDraft(d, saved)
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD((cur) => ({ ...cur, [k]: v }))
  const ownItems = useMemo(() => d.items.map((i) => i.slug).filter(Boolean), [d.items])
  const types = useMemo(() => defaultContext().data.types.types.map((ty) => ty.slug), [])

  // Live validation with the same code the server uses (loaded on demand: it carries zod and the engine).
  useEffect(() => {
    const input = draftToOverlayInput(d)
    if (!input) {
      setLocal(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void import('../../../../game/content').then((m) => {
        if (cancelled) return
        const r = m.validateEventOverlay(input, { smoke: false })
        setLocal({ errors: r.errors, warnings: r.warnings, requiresConfirm: r.requiresConfirm })
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [d])

  const preview = useMemo(() => draftToPublic(d), [d])
  const startMs = fromLocalInput(d.startsAt)
  const endMs = fromLocalInput(d.endsAt)
  const startsInFuture = !Number.isNaN(startMs) && startMs > now
  const risky = useMemo(() => {
    const fromLocal = (local?.warnings ?? []).filter((w) => w.requiresConfirm)
    const extra = serverRisky.filter((s) => !fromLocal.some((w) => w.path === s.path && w.code === s.code))
    return [...fromLocal, ...extra]
  }, [local, serverRisky])

  const applySaved = (ev: AdminEvent) => {
    const next = draftFromEvent(ev)
    setCurrent(ev)
    setSaved(next)
    setD(next)
    setServerIssues(null)
    setServerRisky([])
    onSaved(ev)
  }

  const readBody = () => {
    const { body, problems: found } = draftToBody(d)
    setProblems(found)
    if (found.length > 0) {
      setError(t('eventsAdmin.errors.fix'))
      return null
    }
    setError(null)
    return body
  }

  const showServerIssues = (e: unknown) => {
    const errors = issuesOf(e, 'errors')
    const warnings = issuesOf(e, 'warnings')
    if (errors.length + warnings.length > 0) setServerIssues({ errors, warnings })
  }

  /** Save the draft (no sudo needed): creates it the first time. */
  const saveDraft = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || locked) return
    const body = readBody()
    if (!body) return
    setBusy(true)
    try {
      const res = d.id === null ? await eventsAdminApi.create(body) : await eventsAdminApi.update(d.id, body)
      applySaved(res.event)
    } catch (err) {
      setError(eventsErrorText(err))
      showServerIssues(err)
    } finally {
      setBusy(false)
    }
  }

  const openDialog = (mode: SudoMode) => {
    if (!readBody()) return
    setDialogError(null)
    setServerRisky([])
    setDialog(mode)
  }

  const submitSudo = async (v: SudoSubmit) => {
    if (!dialog || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      if (!elevated) {
        const me = await eventsAdminApi.reauth(v.password)
        onElevated(me.elevated)
      }
      const note = v.note || undefined
      const confirm = v.confirm || undefined
      let res
      if (dialog === 'archive') res = await eventsAdminApi.archive(d.id!, { note })
      else {
        // Save what is on screen first (a draft, or an edit of a published event), then publish.
        const body = draftToBody(d).body
        if (dialog === 'save') {
          // A published event keeps its slug: leave it out of the request.
          const edit: Partial<EventRequestBody> & { confirm?: boolean } = { ...body, confirm }
          delete edit.slug
          res = await eventsAdminApi.update(d.id!, edit)
        } else {
          const saveRes = d.id === null ? await eventsAdminApi.create(body) : dirty ? await eventsAdminApi.update(d.id, body) : { event: current! }
          applySaved(saveRes.event)
          res = await eventsAdminApi.publish(saveRes.event.id, { confirm, note })
        }
      }
      applySaved(res.event)
      setDialog(null)
    } catch (err) {
      if (isApiError(err) && err.code === 'elevation_required') onElevated(false)
      if (isApiError(err) && err.code === 'confirm_required') setServerRisky(issuesOf(err, 'warnings'))
      if (isApiError(err) && err.code === 'validation_failed') {
        showServerIssues(err)
        setDialog(null)
      }
      setDialogError(eventsErrorText(err))
      if (isApiError(err) && err.code === 'validation_failed') setError(eventsErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!d.id) return
    setBusy(true)
    try {
      await eventsAdminApi.remove(d.id)
      onDeleted(d.id)
    } catch (err) {
      setError(eventsErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  const problemFor = (path: string): string | null => {
    const p = problems.find((x) => x.path === path)
    return p ? t(`eventsAdmin.problem.${p.code}`) : null
  }

  // --- list helpers ---------------------------------------------------------------------------------
  const setMission = (i: number, patch: Partial<DraftMission>) => set('missions', d.missions.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const dis = locked || busy
  const startErr = problemFor('startsAt')
  const endErr = problemFor('endsAt')

  const mode: SudoMode = dialog ?? 'publish'
  const issueGroups = serverIssues ?? (local ? { errors: local.errors, warnings: local.warnings } : null)

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void saveDraft(e)} noValidate aria-label={t('eventsAdmin.editor.label')}>
      <EventDatalists ownItems={ownItems} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl break-words">{d.nameEs || d.nameEn || t('eventsAdmin.editor.newTitle')}</h2>
          <p className="text-sm text-mist-300">
            {t(`eventsAdmin.status.${d.status}`)}
            {d.status !== 'new' && ` · ${t('eventsAdmin.editor.revision', { n: d.revision })}`}
            {dirty && <span className="ml-2 text-amber-400">{t('eventsAdmin.editor.unsaved')}</span>}
          </p>
        </div>
        <Button variant="ghost" size="sm" icon="back" onClick={onBack}>
          {t('eventsAdmin.editor.back')}
        </Button>
      </header>

      <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <Panel variant="frame" title={t('eventsAdmin.basics.title')} headingLevel={3}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label={t('eventsAdmin.basics.nameEs')} value={d.nameEs} maxLength={80} onChange={(e) => set('nameEs', e.target.value)} error={problemFor('name.es')} />
              <TextField label={t('eventsAdmin.basics.nameEn')} value={d.nameEn} maxLength={80} onChange={(e) => set('nameEn', e.target.value)} error={problemFor('name.en')} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextArea label={t('eventsAdmin.basics.descEs')} value={d.descEs} maxLength={400} onChange={(e) => set('descEs', e.target.value)} error={problemFor('description.es')} />
              <TextArea label={t('eventsAdmin.basics.descEn')} value={d.descEn} maxLength={400} onChange={(e) => set('descEn', e.target.value)} error={problemFor('description.en')} />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                className="min-w-0 flex-1 basis-60"
                label={t('eventsAdmin.basics.slug')}
                value={d.slug}
                maxLength={64}
                disabled={published}
                onChange={(e) => set('slug', e.target.value.toLowerCase())}
                autoComplete="off"
                spellCheck={false}
                error={problemFor('slug')}
                hint={published ? t('eventsAdmin.basics.slugLocked') : t('eventsAdmin.basics.slugHint')}
              />
              {!published && (
                <Button variant="secondary" size="sm" className="mb-6" onClick={() => set('slug', slugify(d.nameEn || d.nameEs))} disabled={!(d.nameEn || d.nameEs)}>
                  {t('eventsAdmin.basics.slugFromName')}
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.dates.title')} headingLevel={3}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label={t('eventsAdmin.dates.start')} type="datetime-local" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} error={startErr} hint={utc(startMs)} />
              <TextField
                label={t('eventsAdmin.dates.end')}
                type="datetime-local"
                value={d.endsAt}
                min={d.startsAt}
                onChange={(e) => set('endsAt', e.target.value)}
                error={endErr}
                hint={utc(endMs)}
              />
            </div>
            <p className="text-sm text-mist-400">{t('eventsAdmin.dates.zone', { zone: browserTimeZone() })}</p>
          </div>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.image.panel')} headingLevel={3}>
          <ImagePicker imageId={d.imageId} image={d.image} onChange={(id, img) => setD((cur) => ({ ...cur, imageId: id, image: img }))} disabled={locked} />
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.featured.title')} headingLevel={3}>
          <RowList
            label={t('eventsAdmin.featured.label')}
            empty={t('eventsAdmin.featured.empty')}
            addLabel={t('eventsAdmin.featured.add')}
            onAdd={() => set('featured', [...d.featured, { species: '', weightMult: '3' }])}
            count={d.featured.length}
            max={20}
            disabled={dis}
          >
            <ul className="flex flex-col gap-3">
              {d.featured.map((f, i) => (
                <Row key={i} removeLabel={t('eventsAdmin.remove', { n: i + 1 })} onRemove={() => set('featured', d.featured.filter((_, j) => j !== i))} disabled={dis}>
                  <SpeciesInput label={t('eventsAdmin.featured.species')} value={f.species} onChange={(v) => set('featured', d.featured.map((x, j) => (j === i ? { ...x, species: v } : x)))} />
                  <TextField
                    label={t('eventsAdmin.featured.mult')}
                    inputMode="decimal"
                    value={f.weightMult}
                    onChange={(e) => set('featured', d.featured.map((x, j) => (j === i ? { ...x, weightMult: e.target.value } : x)))}
                    error={problemFor(`featured.${i}.weightMult`)}
                    hint={t('eventsAdmin.featured.multHint')}
                  />
                </Row>
              ))}
            </ul>
          </RowList>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.boosts.title')} headingLevel={3}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch checked={d.shinyOn} onChange={(v) => set('shinyOn', v)} label={t('eventsAdmin.boosts.shiny')} disabled={dis} />
                <span className="font-display text-lg">{t('eventsAdmin.boosts.shiny')}</span>
              </div>
              {d.shinyOn && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label={t('eventsAdmin.boosts.shinyPct')}
                    inputMode="decimal"
                    value={d.shinyPct}
                    onChange={(e) => set('shinyPct', e.target.value)}
                    error={problemFor('shiny.chance')}
                    hint={t('eventsAdmin.boosts.shinyPctHint', { base: `${Number((defaultContext().config.encounters.shinyChance * 100).toPrecision(3))}%` })}
                  />
                  <Select
                    label={t('eventsAdmin.boosts.scope')}
                    value={d.shinyScope}
                    onChange={(v) => set('shinyScope', v === 'all' ? 'all' : 'featured')}
                    options={[
                      { value: 'featured', label: t('eventsAdmin.boosts.scopeFeatured') },
                      { value: 'all', label: t('eventsAdmin.boosts.scopeAll') },
                    ]}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch checked={d.legendaryOn} onChange={(v) => set('legendaryOn', v)} label={t('eventsAdmin.boosts.legendary')} disabled={dis} />
                <span className="font-display text-lg">{t('eventsAdmin.boosts.legendary')}</span>
              </div>
              {d.legendaryOn && (
                <TextField
                  label={t('eventsAdmin.boosts.legendaryMult')}
                  inputMode="decimal"
                  value={d.legendaryMult}
                  onChange={(e) => set('legendaryMult', e.target.value)}
                  error={problemFor('legendaryChanceMult')}
                  hint={t('eventsAdmin.boosts.legendaryHint')}
                  className="max-w-xs"
                />
              )}
            </div>
          </div>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.items.title')} headingLevel={3}>
          <RowList
            label={t('eventsAdmin.items.label')}
            empty={t('eventsAdmin.items.empty')}
            addLabel={t('eventsAdmin.items.add')}
            onAdd={() => set('items', [...d.items, { slug: '', nameEs: '', nameEn: '' }])}
            count={d.items.length}
            max={20}
            disabled={dis}
          >
            <ul className="flex flex-col gap-3">
              {d.items.map((it, i) => (
                <Row key={i} removeLabel={t('eventsAdmin.remove', { n: i + 1 })} onRemove={() => set('items', d.items.filter((_, j) => j !== i))} disabled={dis} className="sm:grid-cols-3">
                  <TextField
                    label={t('eventsAdmin.items.slug')}
                    value={it.slug}
                    onChange={(e) => set('items', d.items.map((x, j) => (j === i ? { ...x, slug: e.target.value.trim().toLowerCase() } : x)))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <TextField label={t('eventsAdmin.items.nameEs')} value={it.nameEs} maxLength={80} onChange={(e) => set('items', d.items.map((x, j) => (j === i ? { ...x, nameEs: e.target.value } : x)))} error={problemFor(`items.${i}.names.es`)} />
                  <TextField label={t('eventsAdmin.items.nameEn')} value={it.nameEn} maxLength={80} onChange={(e) => set('items', d.items.map((x, j) => (j === i ? { ...x, nameEn: e.target.value } : x)))} error={problemFor(`items.${i}.names.en`)} />
                </Row>
              ))}
            </ul>
          </RowList>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.drops.title')} headingLevel={3}>
          <RowList
            label={t('eventsAdmin.drops.label')}
            empty={t('eventsAdmin.drops.empty')}
            addLabel={t('eventsAdmin.drops.add')}
            onAdd={() => set('drops', [...d.drops, { item: '', pct: '10', max: '3' }])}
            count={d.drops.length}
            max={10}
            disabled={dis}
          >
            <ul className="flex flex-col gap-3">
              {d.drops.map((x, i) => (
                <Row key={i} removeLabel={t('eventsAdmin.remove', { n: i + 1 })} onRemove={() => set('drops', d.drops.filter((_, j) => j !== i))} disabled={dis} className="sm:grid-cols-3">
                  <ItemInput label={t('eventsAdmin.drops.item')} value={x.item} own={ownItems} onChange={(v) => set('drops', d.drops.map((y, j) => (j === i ? { ...y, item: v } : y)))} />
                  <TextField
                    label={t('eventsAdmin.drops.pct')}
                    inputMode="decimal"
                    value={x.pct}
                    onChange={(e) => set('drops', d.drops.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))}
                    error={problemFor(`drops.${i}.perWaveChance`)}
                    hint={t('eventsAdmin.drops.pctHint')}
                  />
                  <TextField
                    label={t('eventsAdmin.drops.max')}
                    inputMode="numeric"
                    value={x.max}
                    onChange={(e) => set('drops', d.drops.map((y, j) => (j === i ? { ...y, max: e.target.value } : y)))}
                    error={problemFor(`drops.${i}.max`)}
                    hint={t('eventsAdmin.drops.maxHint')}
                  />
                </Row>
              ))}
            </ul>
          </RowList>
        </Panel>

        <Panel variant="frame" title={t('eventsAdmin.missions.title')} headingLevel={3}>
          <RowList
            label={t('eventsAdmin.missions.label')}
            empty={t('eventsAdmin.missions.empty')}
            addLabel={t('eventsAdmin.missions.add')}
            onAdd={() => set('missions', [...d.missions, blankMission(d.missions)])}
            count={d.missions.length}
            max={10}
            disabled={dis}
          >
            <ul className="flex flex-col gap-4">
              {d.missions.map((m, i) => (
                <Row key={i} removeLabel={t('eventsAdmin.remove', { n: i + 1 })} onRemove={() => set('missions', d.missions.filter((_, j) => j !== i))} disabled={dis} className="sm:grid-cols-2">
                  <TextField label={t('eventsAdmin.missions.id')} value={m.id} onChange={(e) => setMission(i, { id: e.target.value.trim().toLowerCase() })} autoComplete="off" spellCheck={false} hint={t('eventsAdmin.missions.idHint')} />
                  <Select
                    label={t('eventsAdmin.missions.kind')}
                    value={m.kind}
                    onChange={(v) => setMission(i, { kind: v as MissionKind, ...(v !== 'catchType' && { type: '' }) })}
                    options={MISSION_KINDS.map((k) => ({ value: k, label: t(`eventsAdmin.missions.kinds.${k}`) }))}
                  />
                  <TextField label={t('eventsAdmin.missions.target')} inputMode="numeric" value={m.target} onChange={(e) => setMission(i, { target: e.target.value })} error={problemFor(`missions.${i}.target`)} />
                  {m.kind === 'longSession' && (
                    <TextField label={t('eventsAdmin.missions.minMinutes')} inputMode="numeric" value={m.minMinutes} onChange={(e) => setMission(i, { minMinutes: e.target.value })} error={problemFor(`missions.${i}.minMinutes`)} />
                  )}
                  {m.kind === 'catchType' && (
                    <Select
                      label={t('eventsAdmin.missions.type')}
                      value={m.type || 'random'}
                      onChange={(v) => setMission(i, { type: v })}
                      options={[{ value: 'random', label: t('eventsAdmin.missions.typeRandom') }, ...types.map((ty) => ({ value: ty, label: typeName(ty, lng) }))]}
                    />
                  )}
                  <TextField label={t('eventsAdmin.missions.minLevel')} inputMode="numeric" value={m.minTrainerLevel} onChange={(e) => setMission(i, { minTrainerLevel: e.target.value })} error={problemFor(`missions.${i}.minTrainerLevel`)} hint={t('eventsAdmin.missions.minLevelHint')} />
                  <TextField label={t('eventsAdmin.missions.titleEs')} value={m.titleEs} maxLength={80} onChange={(e) => setMission(i, { titleEs: e.target.value })} error={problemFor(`missions.${i}.title.es`)} hint={t('eventsAdmin.missions.placeholders')} />
                  <TextField label={t('eventsAdmin.missions.titleEn')} value={m.titleEn} maxLength={80} onChange={(e) => setMission(i, { titleEn: e.target.value })} error={problemFor(`missions.${i}.title.en`)} />
                  <TextField label={t('eventsAdmin.missions.descEs')} value={m.descEs} maxLength={400} onChange={(e) => setMission(i, { descEs: e.target.value })} error={problemFor(`missions.${i}.description.es`)} />
                  <TextField label={t('eventsAdmin.missions.descEn')} value={m.descEn} maxLength={400} onChange={(e) => setMission(i, { descEn: e.target.value })} error={problemFor(`missions.${i}.description.en`)} />
                  <fieldset className="col-span-full m-0 flex min-w-0 flex-col gap-3 border-0 bg-dusk-800 p-3">
                    <legend className="px-1 font-display text-base text-mist-300">{t('eventsAdmin.missions.reward')}</legend>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <TextField label={t('eventsAdmin.missions.dust')} inputMode="numeric" value={m.dust} onChange={(e) => setMission(i, { dust: e.target.value })} error={problemFor(`missions.${i}.dust`)} />
                      {m.kind === 'catchType' && m.type !== '' && m.type !== 'random' && (
                        <TextField label={t('eventsAdmin.missions.candies')} inputMode="numeric" value={m.typeCandies} onChange={(e) => setMission(i, { typeCandies: e.target.value })} error={problemFor(`missions.${i}.typeCandies`)} />
                      )}
                    </div>
                    <ul className="flex flex-col gap-2">
                      {m.items.map((r, j) => (
                        <li key={j} className="flex items-start gap-2">
                          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                            <ItemInput label={t('eventsAdmin.missions.rewardItem')} value={r.item} own={ownItems} onChange={(v) => setMission(i, { items: m.items.map((x, k) => (k === j ? { ...x, item: v } : x)) })} />
                            <TextField label={t('eventsAdmin.missions.rewardCount')} inputMode="numeric" value={r.count} onChange={(e) => setMission(i, { items: m.items.map((x, k) => (k === j ? { ...x, count: e.target.value } : x)) })} error={problemFor(`missions.${i}.items.${j}.count`)} />
                          </div>
                          <IconButton icon="trash" size="sm" variant="ghost" label={t('eventsAdmin.remove', { n: j + 1 })} onClick={() => setMission(i, { items: m.items.filter((_, k) => k !== j) })} className="mt-7 shrink-0" />
                        </li>
                      ))}
                    </ul>
                    <Button variant="secondary" size="sm" icon="plus" className="self-start" onClick={() => setMission(i, { items: [...m.items, { item: '', count: '1' }] })}>
                      {t('eventsAdmin.missions.addItem')}
                    </Button>
                    {(m.moreTiers.length > 0 || m.tierRest.randomItem || m.tierRest.minTrainerLevel !== undefined) && (
                      <p className="text-sm text-mist-400">{t('eventsAdmin.missions.keptTiers', { count: m.moreTiers.length })}</p>
                    )}
                  </fieldset>
                </Row>
              ))}
            </ul>
          </RowList>
        </Panel>
      </fieldset>

      <Panel variant="frame" title={t('eventsAdmin.validation.title')} headingLevel={3}>
        <Validation problems={problems} groups={issueGroups} fromServer={serverIssues !== null} saved={current?.validation ?? null} dirty={dirty} />
      </Panel>

      <Panel variant="frame" title={t('eventsAdmin.preview.title')} headingLevel={3}>
        {preview ? (
          <div className="max-w-xl">
            <EventCard event={preview} now={now} baseShinyChance={defaultContext().config.encounters.shinyChance} headingLevel={3} />
          </div>
        ) : (
          <p className="text-mist-400">{t('eventsAdmin.preview.unavailable')}</p>
        )}
      </Panel>

      <Panel variant="frame" title={t('eventsAdmin.spawn.title')} headingLevel={3}>
        <SpawnPreview eventId={current?.id ?? null} featured={saved.featured.map((f) => f.species)} dirty={dirty} />
      </Panel>

      <div className="flex flex-col gap-3 bg-dusk-900 p-4 inset-shadow-well">
        <p className="min-h-5 text-sm break-words text-cheek-400" role="alert">
          {error}
        </p>
        <div className="flex flex-wrap gap-3">
          {d.status === 'new' || d.status === 'draft' ? (
            <>
              <Button type="submit" icon="check" disabled={busy || !dirty}>
                {busy ? t('common.loading') : t('eventsAdmin.actions.saveValidate')}
              </Button>
              <Button variant="secondary" icon="star" disabled={busy} onClick={() => openDialog(startsInFuture ? 'schedule' : 'publish')}>
                {startsInFuture ? t('eventsAdmin.actions.schedule') : t('eventsAdmin.actions.publish')}
              </Button>
              {d.status === 'draft' && (
                <Button variant="ghost" icon="trash" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  {t('eventsAdmin.actions.delete')}
                </Button>
              )}
            </>
          ) : null}
          {published && (
            <>
              <Button icon="check" disabled={busy || !dirty} onClick={() => openDialog('save')}>
                {t('eventsAdmin.actions.saveChanges')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => openDialog('archive')}>
                {t('eventsAdmin.actions.archive')}
              </Button>
            </>
          )}
          {d.id && (
            <Button variant="ghost" icon="copy" disabled={busy} onClick={() => onDuplicate({ ...d, id: null, status: 'new', revision: 1, slug: `${d.slug}-2`.slice(0, 64), nameEs: `${d.nameEs} (2)`.trim(), nameEn: `${d.nameEn} (2)`.trim() })}>
              {t('eventsAdmin.actions.duplicate')}
            </Button>
          )}
        </div>
        <p className={cx('text-sm text-mist-400')}>{t(`eventsAdmin.actions.help.${d.status}`)}</p>
      </div>

      <SudoDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        mode={mode}
        eventName={(lng === 'en' ? d.nameEn || d.nameEs : d.nameEs || d.nameEn)}
        elevated={elevated}
        risky={risky}
        busy={busy}
        error={dialogError}
        onSubmit={(v) => void submitSudo(v)}
      />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('eventsAdmin.delete.title')}
        description={t('eventsAdmin.delete.body', { name: d.nameEs || d.nameEn })}
        footer={
          <>
            <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
            <Button variant="danger" onClick={() => void remove().then(() => setConfirmDelete(false))}>
              {t('eventsAdmin.actions.delete')}
            </Button>
          </>
        }
      />
    </form>
  )
}

/** Errors and warnings of the form: from this screen's live check, or the server's last answer. */
function Validation({ problems, groups, fromServer, saved, dirty }: { problems: DraftProblem[]; groups: { errors: IssueLike[]; warnings: IssueLike[] } | null; fromServer: boolean; saved: AdminEvent['validation']; dirty: boolean }) {
  const { t, i18n } = useTranslation()
  const errors = groups?.errors ?? []
  const warnings = groups?.warnings ?? []
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {problems.length > 0 && <p className="text-cheek-400">{t('eventsAdmin.validation.missing', { count: problems.length })}</p>}
      {groups === null && problems.length === 0 && <p className="text-mist-400">{t('eventsAdmin.validation.pending')}</p>}
      {groups && errors.length === 0 && warnings.length === 0 && <p className="text-leaf-400">{t('eventsAdmin.validation.ok')}</p>}
      {fromServer && <p className="text-sm text-mist-400">{t('eventsAdmin.validation.fromServer')}</p>}
      {errors.length > 0 && <IssueList title={t('eventsAdmin.validation.errors', { count: errors.length })} issues={errors} tone="error" />}
      {warnings.length > 0 && <IssueList title={t('eventsAdmin.validation.warnings', { count: warnings.length })} issues={warnings} tone="warn" />}
      {saved && !dirty && (
        <p className="text-sm text-mist-400">
          {t('eventsAdmin.validation.saved', { errors: saved.errors.length, warnings: saved.warnings.length, when: new Date(saved.at).toLocaleString(i18n.language) })}
        </p>
      )}
      <p className="text-sm text-mist-400">{t('eventsAdmin.validation.note')}</p>
    </div>
  )
}

function IssueList({ title, issues, tone }: { title: string; issues: IssueLike[]; tone: 'error' | 'warn' }) {
  return (
    <div className="flex flex-col gap-1">
      <p className={cx('font-display text-base', tone === 'error' ? 'text-cheek-400' : 'text-amber-400')}>{title}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {issues.map((i, n) => (
          <li key={`${i.path}-${i.code}-${n}`} className="break-words">
            {i.path && <code className="mr-1.5 bg-dusk-900 px-1 text-mist-300">{i.path}</code>}
            {issueText(i)}
            {i.requiresConfirm && <span className="ml-1.5 text-amber-400">×</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
