import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { graphemeCount, NICKNAME_MAX, normalizeNickname, type OwnedPokemon } from '../../../engine'
import { Button, Dialog, TextField, toast } from '../../components'
import { errorText } from '../../lib/errors'
import { useNames } from '../../lib/names'
import { useGame } from '../../store/game'
import { useBusy } from '../../store/selectors'

/** Live check of what the player typed: the engine's own rule, so the UI and the server never disagree. */
export function nicknameDraft(draft: string): { count: number; error: 'nickname_too_long' | 'nickname_invalid' | null; clean: string | null } {
  const r = normalizeNickname(draft)
  return { count: graphemeCount(draft.trim()), error: r.ok ? null : r.error, clean: r.ok ? r.value : null }
}

export interface NicknameFormProps {
  draft: string
  onDraft: (v: string) => void
  /** Species name shown in the hint ("Pikachu: 12 characters at most"). */
  speciesName: string
  hasNickname: boolean
  busy?: boolean
  onSubmit: () => void
  onRemove: () => void
  onCancel: () => void
}

/** The form inside the nickname dialog (props only, so it renders without a store). */
export function NicknameForm({ draft, onDraft, speciesName, hasNickname, busy, onSubmit, onRemove, onCancel }: NicknameFormProps) {
  const { t } = useTranslation()
  const { count, error } = nicknameDraft(draft)
  const counter = `${count}/${NICKNAME_MAX}`
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!error && !busy) onSubmit()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('nick.label')}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        placeholder={speciesName}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        autoFocus
        error={error ? t(`nick.error.${error}`, { max: NICKNAME_MAX }) : null}
        hint={t('nick.hint', { max: NICKNAME_MAX })}
      />
      <p className="-mt-3 text-right font-num text-lg leading-none tabular text-mist-300" aria-hidden="true">
        {counter}
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        {hasNickname && (
          <Button variant="ghost" icon="trash" disabled={busy} onClick={onRemove} className="mr-auto">
            {t('nick.remove')}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={Boolean(error) || busy}>
          {t('nick.save')}
        </Button>
      </div>
    </form>
  )
}

/** "Set a nickname" dialog on the Pokémon sheet. Saves through the server (which validates again). */
export function NicknameDialog({ open, onOpenChange, mon }: { open: boolean; onOpenChange: (open: boolean) => void; mon: OwnedPokemon }) {
  const { t } = useTranslation()
  const names = useNames()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('nick.title', { species: names.species(mon.speciesSlug) })} description={t('nick.body')}>
      {/* Mounted only while open, so the draft starts from the saved nickname each time. */}
      <NicknameBody mon={mon} onDone={() => onOpenChange(false)} />
    </Dialog>
  )
}

function NicknameBody({ mon, onDone }: { mon: OwnedPokemon; onDone: () => void }) {
  const { t } = useTranslation()
  const names = useNames()
  const setNickname = useGame((s) => s.setNickname)
  const busy = useBusy()
  const [draft, setDraft] = useState(mon.nickname ?? '')

  const save = async (value: string | null) => {
    const err = await setNickname(mon.uid, value)
    if (err) {
      toast.add({ title: errorText(err, 'box'), type: 'danger' })
      return
    }
    onDone()
    const species = names.species(mon.speciesSlug)
    toast.add({ title: value ? t('nick.saved', { name: value, species }) : t('nick.removed', { name: species }), type: 'success' })
  }

  return (
    <NicknameForm
      draft={draft}
      onDraft={setDraft}
      speciesName={names.species(mon.speciesSlug)}
      hasNickname={Boolean(mon.nickname)}
      busy={busy}
      onSubmit={() => void save(nicknameDraft(draft).clean)}
      onRemove={() => void save(null)}
      onCancel={onDone}
    />
  )
}
