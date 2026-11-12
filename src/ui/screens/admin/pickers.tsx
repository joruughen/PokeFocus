/**
 * Option lists for the admin's searchable pickers (`Combobox`): species with
 * sprite, number, types and stage; items with sprite and category. The value of
 * every option is the slug.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, type LocaleCode } from '../../../engine'
import { Combobox, Sprite, TypeBadge, type ComboboxOption } from '../../components'
import { asLocale, itemName, speciesName } from '../../lib/names'
import { categorizeItem } from '../bag/bagItems'

const OTHER: Record<LocaleCode, LocaleCode> = { es: 'en', en: 'es' }

/** Every species of the live content, in Pokédex order. Searchable by name (both languages), slug and number. */
export function useSpeciesOptions(): ComboboxOption[] {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  return useMemo(
    () =>
      [...defaultContext().data.species]
        .sort((a, b) => a.id - b.id)
        .map((s) => {
          const name = speciesName(s.slug, lng)
          const other = speciesName(s.slug, OTHER[lng])
          const num = `#${String(s.id).padStart(3, '0')}`
          return {
            value: s.slug,
            label: name,
            code: s.id,
            keywords: [other, s.slug],
            icon: <Sprite kind="icon" slug={s.slug} alt="" />,
            secondary: [num, t('combobox.stage', { n: s.stage }), other !== name ? other : ''].filter(Boolean).join(' · '),
            trailing: s.types.map((ty) => <TypeBadge key={ty} type={ty} />),
          }
        }),
    // `t` changes with the language, which is what the labels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lng, t],
  )
}

/** Game items, mission-only items and any `extra` slugs (an event's own items), by name. `gameOnly`: just the game's items. */
export function useItemOptions(extra: readonly string[] = [], gameOnly = false): ComboboxOption[] {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const extraKey = extra.join('\n')
  return useMemo(() => {
    const ctx = defaultContext()
    const slugs = [...new Set([...ctx.data.items.map((i) => i.slug), ...(gameOnly ? [] : [...Object.keys(ctx.missions.placeholderItems), ...extra.filter(Boolean)])])]
    return slugs
      .map((slug) => {
        const name = itemName(slug, lng)
        const other = itemName(slug, OTHER[lng])
        const category = t(`bag.cat.${categorizeItem(slug, ctx)}`)
        return {
          value: slug,
          label: name,
          keywords: [other, category],
          icon: <Sprite kind="item" slug={slug} fit={32} alt="" />,
          secondary: [category, name !== slug ? slug : ''].filter(Boolean).join(' · '),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, lng))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `extraKey` stands for `extra`
  }, [lng, t, extraKey, gameOnly])
}

interface PickerProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
  disabled?: boolean
  className?: string
}

/** Species picker: pick from the list (type a name, slug or Pokédex number); the value is the slug. */
export function SpeciesCombobox({ hint, ...rest }: PickerProps) {
  const { t } = useTranslation()
  return <Combobox {...rest} options={useSpeciesOptions()} placeholder={t('combobox.pickSpecies')} hint={hint} />
}

/** Item picker: the value is the slug. By default `own` (the event's own items) are listed and free text is allowed; `strict` lists only the game's items and accepts nothing else. */
export function ItemCombobox({ own = [], strict = false, ...rest }: PickerProps & { own?: readonly string[]; strict?: boolean }) {
  const { t } = useTranslation()
  return <Combobox {...rest} options={useItemOptions(own, strict)} freeText={!strict} normalize={(s) => s.trim().toLowerCase()} placeholder={t('combobox.pickItem')} />
}
