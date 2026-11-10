import { useId, useMemo, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext } from '../../../../engine'
import { Button, IconButton, TextField } from '../../../components'
import { cx } from '../../../lib/cx'
import { asLocale, itemName, speciesName } from '../../../lib/names'

export const SPECIES_LIST = 'event-species-options'
export const ITEM_LIST = 'event-item-options'

/** `<datalist>`s of the species and items the form suggests (the event's own items too). One per form. */
export function EventDatalists({ ownItems }: { ownItems: readonly string[] }) {
  const { i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const ctx = defaultContext()
  const species = useMemo(() => ctx.data.species.map((s) => ({ slug: s.slug, name: speciesName(s.slug, lng) })), [ctx, lng])
  const items = useMemo(() => [...new Set([...ctx.data.items.map((i) => i.slug), ...Object.keys(ctx.missions.placeholderItems)])].map((slug) => ({ slug, name: itemName(slug, lng) })), [ctx, lng])
  return (
    <>
      <datalist id={SPECIES_LIST}>
        {species.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </datalist>
      <datalist id={ITEM_LIST}>
        {[...items, ...ownItems.filter((o) => o && !items.some((i) => i.slug === o)).map((slug) => ({ slug, name: slug }))].map((i) => (
          <option key={i.slug} value={i.slug}>
            {i.name}
          </option>
        ))}
      </datalist>
    </>
  )
}

/** A species slug with name suggestions; says which species it is, or that it is unknown. */
export function SpeciesInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation()
  const known = defaultContext().speciesBySlug.has(value)
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
      list={SPECIES_LIST}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      error={value !== '' && !known ? t('eventsAdmin.unknownSpecies') : null}
      hint={known ? speciesName(value, asLocale(i18n.language)) : t('eventsAdmin.speciesHint')}
    />
  )
}

/** An item slug with suggestions (game items, mission-only items and this event's own items). */
export function ItemInput({ label, value, onChange, own, disabled }: { label: string; value: string; onChange: (v: string) => void; own: readonly string[]; disabled?: boolean }) {
  const { t, i18n } = useTranslation()
  const ctx = defaultContext()
  const known = value === '' || ctx.data.items.some((i) => i.slug === value) || value in ctx.missions.placeholderItems || own.includes(value)
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
      list={ITEM_LIST}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      error={!known ? t('eventsAdmin.unknownItem') : null}
      hint={value !== '' && known ? itemName(value, asLocale(i18n.language)) : t('eventsAdmin.itemHint')}
    />
  )
}

/** A repeating group: title, the rows (each with a remove button), and an add button. */
export function RowList({
  label,
  empty,
  addLabel,
  onAdd,
  disabled,
  max,
  count,
  children,
}: {
  label: string
  empty: string
  addLabel: string
  onAdd: () => void
  disabled?: boolean
  max?: number
  count: number
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-base text-mist-300">
        {label}
        {max !== undefined && (
          <span className="ml-2 text-sm text-mist-400">
            {count}/{max}
          </span>
        )}
      </p>
      {count === 0 ? <p className="text-sm text-mist-400">{empty}</p> : children}
      <Button variant="secondary" size="sm" icon="plus" onClick={onAdd} disabled={disabled || (max !== undefined && count >= max)} className="self-start">
        {addLabel}
      </Button>
    </div>
  )
}

/** One row of a `RowList`: its fields in a responsive grid and a remove button. */
export function Row({ children, removeLabel, onRemove, disabled, className }: { children: ReactNode; removeLabel: string; onRemove: () => void; disabled?: boolean; className?: string }) {
  return (
    <li className="flex items-start gap-2 bg-dusk-900 p-3 inset-shadow-well">
      <div className={cx('grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2', className)}>{children}</div>
      <IconButton icon="trash" size="sm" variant="ghost" label={removeLabel} onClick={onRemove} disabled={disabled} className="shrink-0" />
    </li>
  )
}

/** Labelled multi-line text (same look as `TextField`). */
export function TextArea({ label, hint, error, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId()
  const msg = `${id}-msg`
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="font-display text-base text-mist-300">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? msg : undefined}
        className={cx('min-h-24 w-full bg-dusk-900 px-3 py-2 text-lg text-mist-50 shadow-frame inset-shadow-well placeholder:text-mist-400 disabled:text-mist-400', error && 'outline-2 -outline-offset-2 outline-cheek-400')}
        {...rest}
      />
      <p id={msg} className={cx('text-sm', error ? 'text-cheek-400' : 'text-mist-400')}>
        {error ?? hint ?? null}
      </p>
    </div>
  )
}
