import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { graphemeCount, MAX_TEAM_PRESETS, normalizePresetName, PRESET_NAME_MAX } from '../../../engine'
import { Button, Dialog, DialogClose, IconButton, Panel, PixelIcon, Sprite, TextField, toast } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { useNames } from '../../lib/names'
import { useGame } from '../../store/game'
import { useBusy, usePlayer } from '../../store/selectors'
import { presetRows, type PresetRow } from './presets'

/** Error text of a failed preset action (own family first, then the shared box errors). */
const presetError = (code: string) => errorText(code, 'preset')

/** Make a saved team the active one, with the toasts (success, and a note when released members were skipped). */
export function useApplyPreset() {
  const { t } = useTranslation()
  const apply = useGame((s) => s.applyPreset)
  const player = usePlayer()
  return async (id: string) => {
    const preset = player.teamPresets?.find((p) => p.id === id)
    const r = await apply(id)
    if (!r.ok) {
      toast.add({ title: presetError(r.error), type: 'danger' })
      return false
    }
    const name = preset?.name ?? ''
    toast.add({
      title: t('presets.applied', { name }),
      description: r.missing > 0 ? t('presets.appliedMissing', { count: r.missing }) : undefined,
      type: r.missing > 0 ? 'info' : 'success',
    })
    return true
  }
}

function Members({ row, size = 'md' }: { row: PresetRow; size?: 'sm' | 'md' }) {
  const names = useNames()
  return (
    <ol className="flex flex-wrap items-center gap-0.5" aria-label={row.members.map((m) => names.pokemon(m)).join(', ')}>
      {row.members.map((m, i) => (
        <li key={m.uid} className={cx('relative grid place-items-center bg-dusk-900 inset-shadow-well', size === 'sm' ? 'size-9' : 'h-11 w-12')} title={names.pokemonFull(m)}>
          <Sprite kind="icon" slug={m.speciesSlug} alt="" />
          {i === 0 && <PixelIcon name="crown" size={10} className="absolute top-0 left-0 bg-volt-400 p-px text-ink" />}
        </li>
      ))}
    </ol>
  )
}

export interface TeamPresetsViewProps {
  rows: PresetRow[]
  /** No session running and no request in flight. */
  canSwitch: boolean
  busy: boolean
  draft: string
  onDraft: (v: string) => void
  onSave: () => void
  onApply: (id: string) => void
  onOverwrite: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}

/** The saved-teams panel (props only, so it renders in tests without a store). */
export function TeamPresetsView({ rows, canSwitch, busy, draft, onDraft, onSave, onApply, onOverwrite, onRename, onDelete }: TeamPresetsViewProps) {
  const { t } = useTranslation()
  const check = normalizePresetName(draft)
  const blank = draft.trim() === ''
  const error = !blank && !check.ok ? t(`presets.error.${check.error}`, { max: PRESET_NAME_MAX }) : null
  const full = rows.length >= MAX_TEAM_PRESETS
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (check.ok && !full && !busy) onSave()
  }
  return (
    <Panel title={t('presets.title')} actions={<span className="font-num text-xl leading-none tabular text-mist-300">{rows.length}/{MAX_TEAM_PRESETS}</span>}>
      <p className="-mt-2 mb-4 max-w-[62ch] text-sm text-mist-300">{t('presets.intro')}</p>
      {!canSwitch && (
        <p className="mb-4 flex items-center gap-2 bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well">
          <PixelIcon name="lock" size={20} className="shrink-0" />
          {t('presets.locked')}
        </p>
      )}

      <form onSubmit={submit} className="mb-5 flex flex-wrap items-start gap-3" noValidate>
        <TextField
          className="min-w-0 flex-1 basis-48"
          label={t('presets.nameLabel')}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={t('presets.namePlaceholder')}
          autoComplete="off"
          disabled={full}
          error={error}
          hint={full ? t('presets.full', { max: MAX_TEAM_PRESETS }) : t('presets.nameHint', { count: graphemeCount(draft.trim()), max: PRESET_NAME_MAX })}
        />
        <Button type="submit" icon="plus" disabled={!check.ok || full || busy} className="mt-[1.9rem]">
          {t('presets.save')}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="bg-dusk-900 p-4 text-sm text-mist-300 inset-shadow-well">{t('presets.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('presets.title')}>
          {rows.map((row) => (
            <li key={row.preset.id} className={cx('flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well', row.active && 'outline-2 -outline-offset-2 outline-volt-400')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 font-display text-lg leading-tight [overflow-wrap:anywhere]">{row.preset.name}</span>
                {row.active && (
                  <span className="inline-flex h-6 items-center gap-1 bg-volt-400 px-2 font-display text-sm text-ink shadow-frame">
                    <PixelIcon name="check" size={10} />
                    {t('presets.active')}
                  </span>
                )}
                {row.missing > 0 && (
                  <span className="inline-flex items-center gap-1 text-sm text-amber-400">
                    <PixelIcon name="bolt" size={10} />
                    {row.members.length === 0 ? t('presets.allGone') : t('presets.someGone', { count: row.missing })}
                  </span>
                )}
              </div>
              {row.members.length > 0 && <Members row={row} />}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon="play" disabled={!canSwitch || busy || row.active || row.members.length === 0} onClick={() => onApply(row.preset.id)} aria-label={t('presets.useOf', { name: row.preset.name })}>
                  {t('presets.use')}
                </Button>
                <Button size="sm" variant="secondary" icon="reroll" disabled={busy || row.active} onClick={() => onOverwrite(row.preset.id)} aria-label={t('presets.overwriteOf', { name: row.preset.name })}>
                  {t('presets.overwrite')}
                </Button>
                <IconButton icon="wrench" size="sm" variant="ghost" label={t('presets.renameOf', { name: row.preset.name })} disabled={busy} onClick={() => onRename(row.preset.id)} />
                <IconButton icon="trash" size="sm" variant="ghost" label={t('presets.deleteOf', { name: row.preset.name })} disabled={busy} onClick={() => onDelete(row.preset.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

type Pending = { kind: 'rename' | 'overwrite' | 'delete'; id: string } | null

/** Saved teams on the Team screen: save the current team, use, update, rename and delete. */
export function TeamPresetsPanel() {
  const { t } = useTranslation()
  const player = usePlayer()
  const busy = useBusy()
  const savePreset = useGame((s) => s.savePreset)
  const renamePreset = useGame((s) => s.renamePreset)
  const overwritePreset = useGame((s) => s.overwritePreset)
  const deletePreset = useGame((s) => s.deletePreset)
  const applyPreset = useApplyPreset()
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const rows = presetRows(player)
  const target = pending ? rows.find((r) => r.preset.id === pending.id) : undefined

  const save = async () => {
    const r = await savePreset(draft)
    if (!r.ok) {
      toast.add({ title: presetError(r.error), type: 'danger' })
      return
    }
    toast.add({ title: t('presets.saved', { name: draft.trim() }), type: 'success' })
    setDraft('')
  }
  const run = async (fn: () => Promise<string | null>, ok: string) => {
    const err = await fn()
    if (err) {
      toast.add({ title: presetError(err), type: 'danger' })
      return
    }
    toast.add({ title: ok, type: 'success' })
    setPending(null)
  }

  return (
    <>
      <TeamPresetsView
        rows={rows}
        canSwitch={!player.activeSession}
        busy={busy}
        draft={draft}
        onDraft={setDraft}
        onSave={() => void save()}
        onApply={(id) => void applyPreset(id)}
        onOverwrite={(id) => setPending({ kind: 'overwrite', id })}
        onRename={(id) => setPending({ kind: 'rename', id })}
        onDelete={(id) => setPending({ kind: 'delete', id })}
      />

      <Dialog
        open={pending?.kind === 'overwrite' && Boolean(target)}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('presets.overwriteTitle', { name: target?.preset.name ?? '' })}
        description={t('presets.overwriteBody')}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button disabled={busy} onClick={() => target && void run(() => overwritePreset(target.preset.id), t('presets.overwritten', { name: target.preset.name }))}>
              {t('presets.overwriteConfirm')}
            </Button>
          </>
        }
      />
      <Dialog
        open={pending?.kind === 'delete' && Boolean(target)}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('presets.deleteTitle', { name: target?.preset.name ?? '' })}
        description={t('presets.deleteBody')}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button variant="danger" icon="trash" disabled={busy} onClick={() => target && void run(() => deletePreset(target.preset.id), t('presets.deleted', { name: target.preset.name }))}>
              {t('presets.deleteConfirm')}
            </Button>
          </>
        }
      />
      <Dialog open={pending?.kind === 'rename' && Boolean(target)} onOpenChange={(o) => !o && setPending(null)} title={t('presets.renameTitle')}>
        {target && <RenameForm key={target.preset.id} initial={target.preset.name} busy={busy} onSubmit={(name) => void run(() => renamePreset(target.preset.id, name), t('presets.renamed', { name: name.trim() }))} onCancel={() => setPending(null)} />}
      </Dialog>
    </>
  )
}

function RenameForm({ initial, busy, onSubmit, onCancel }: { initial: string; busy: boolean; onSubmit: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  const check = normalizePresetName(name)
  const error = name.trim() !== '' && !check.ok ? t(`presets.error.${check.error}`, { max: PRESET_NAME_MAX }) : null
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (check.ok && !busy) onSubmit(name)
      }}
    >
      <TextField label={t('presets.nameLabel')} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" error={error} hint={t('presets.nameHint', { count: graphemeCount(name.trim()), max: PRESET_NAME_MAX })} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!check.ok || busy}>
          {t('presets.renameConfirm')}
        </Button>
      </div>
    </form>
  )
}

export interface QuickTeamSwitchViewProps {
  rows: PresetRow[]
  canSwitch: boolean
  busy: boolean
  onApply: (id: string) => void
}

/** Chips to change the active team in one tap (home, before starting a session). Renders nothing without saved teams. */
export function QuickTeamSwitchView({ rows, canSwitch, busy, onApply }: QuickTeamSwitchViewProps) {
  const { t } = useTranslation()
  if (rows.length === 0) return null
  return (
    <section aria-label={t('presets.quickTitle')} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg text-mist-300">{t('presets.quickTitle')}</h2>
        <a href="#/team" className="text-sm text-mist-300 underline decoration-dusk-500 underline-offset-4 hover:text-volt-300">
          {t('presets.manage')}
        </a>
      </div>
      <ul className="flex flex-wrap gap-2">
        {rows.map((row) => (
          <li key={row.preset.id} className="max-w-full">
            <button
              type="button"
              aria-pressed={row.active}
              disabled={!canSwitch || busy || row.members.length === 0}
              onClick={() => !row.active && onApply(row.preset.id)}
              title={row.missing > 0 ? t('presets.someGone', { count: row.missing }) : undefined}
              className={cx(
                'inline-flex min-h-11 max-w-full items-center gap-2 px-3 text-left font-display text-base shadow-frame transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                row.active ? 'bg-volt-400 text-ink' : 'bg-dusk-700 text-mist-50 hover:bg-dusk-600',
              )}
            >
              <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                {row.members.slice(0, 3).map((m) => (
                  <Sprite key={m.uid} kind="icon" slug={m.speciesSlug} alt="" />
                ))}
              </span>
              <span className="min-w-0 truncate">{row.preset.name}</span>
              {row.missing > 0 && <PixelIcon name="bolt" size={10} className="shrink-0 text-amber-400" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function QuickTeamSwitch() {
  const player = usePlayer()
  const busy = useBusy()
  const apply = useApplyPreset()
  return <QuickTeamSwitchView rows={presetRows(player)} canSwitch={!player.activeSession} busy={busy} onApply={(id) => void apply(id)} />
}
