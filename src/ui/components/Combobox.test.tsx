/** Render smoke test of the Combobox and the admin pickers (server-side render, closed list). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { ItemCombobox, SpeciesCombobox, useItemOptions, useSpeciesOptions } from '../screens/admin/pickers'
import { filterOptions } from './comboboxFilter'
import { Combobox, type ComboboxOption } from './Combobox'

const OPTIONS: ComboboxOption[] = [
  { value: 'potion', label: 'Poción', secondary: 'Curación' },
  { value: 'ether', label: 'Éter' },
]

/** The options a hook gives, read through a throwaway component. */
function grab<T>(use: () => T): T {
  let out: T | undefined
  function Grab() {
    out = use()
    return null
  }
  renderToStaticMarkup(<Grab />)
  return out as T
}

describe('Combobox', () => {
  it('renders a labelled combobox input showing the chosen option name, closed', async () => {
    await i18n.changeLanguage('es')
    const html = renderToStaticMarkup(<Combobox label="Objeto" options={OPTIONS} value="potion" onChange={() => undefined} hint="Ayuda" />)
    expect(html).toContain('Objeto')
    expect(html).toMatch(/role="combobox"/)
    expect(html).toContain('value="Poción"')
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toContain('Ayuda')
    expect(html).toContain(i18n.t('combobox.show'))
    expect(html).not.toMatch(/combobox\.[a-zA-Z]+/)
    expect(html).not.toContain('<datalist')
    expect(html).not.toContain('role="listbox"') // the list only exists while open
  })

  it('shows free text as it is, an error, and the disabled state', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(<Combobox label="Item" options={OPTIONS} value="my-item" onChange={() => undefined} freeText error="No such item" disabled />)
    expect(html).toContain('value="my-item"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('No such item')
    expect(html).toMatch(/disabled/)
  })

  it('has no value text for an empty value', () => {
    const html = renderToStaticMarkup(<Combobox label="Item" options={OPTIONS} value="" onChange={() => undefined} placeholder="Search" />)
    expect(html).toContain('placeholder="Search"')
    expect(html).toContain('value=""')
  })
})

describe('admin pickers', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`the species picker shows the species name in the interface language (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<SpeciesCombobox label="Species" value="charizard" onChange={() => undefined} />)
      expect(html).toContain('value="Charizard"')
      expect(html).toContain(i18n.t('combobox.pickSpecies'))
      const bulba = renderToStaticMarkup(<SpeciesCombobox label="Species" value="bulbasaur" onChange={() => undefined} />)
      expect(bulba).toContain('value="Bulbasaur"')
    })

    it(`species options carry sprite, number, stage, types and the other language name (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const pikachu = grab(useSpeciesOptions).find((o) => o.value === 'pikachu')!
      expect(pikachu.label).toBe('Pikachu')
      expect(pikachu.code).toBe(25)
      expect(pikachu.icon).toBeTruthy()
      expect(pikachu.secondary).toContain('#025')
      expect(pikachu.secondary).toContain(i18n.t('combobox.stage', { n: 1 }))
      expect(pikachu.secondary).not.toMatch(/combobox\./)
      expect(Array.isArray(pikachu.trailing) ? pikachu.trailing.length : 0).toBe(1)
    })
  }

  it('finds species by Spanish name, English name, slug and number', async () => {
    await i18n.changeLanguage('es')
    const options = grab(useSpeciesOptions)
    const pick = (q: string) => filterOptions(options, q).map((o) => o.value)
    expect(pick('pikachu')[0]).toBe('pikachu')
    expect(pick('pika')[0]).toBe('pikachu')
    expect(pick('25')[0]).toBe('pikachu')
    expect(pick('#025')[0]).toBe('pikachu')
    expect(pick('IVYSAUR')[0]).toBe('ivysaur')
    expect(pick('saur')).toEqual(['bulbasaur', 'ivysaur', 'venusaur'])
    expect(options.length).toBeGreaterThan(50)
    // Sorted by Pokédex number.
    expect(options[0]!.value).toBe('bulbasaur')
  })

  it('item options include the event’s own items and a category, and find by name or slug', async () => {
    await i18n.changeLanguage('en')
    const options = grab(() => useItemOptions(['golden-feather']))
    expect(options.some((o) => o.value === 'golden-feather')).toBe(true)
    const potion = options.find((o) => o.value === 'potion')!
    expect(potion.secondary).toContain(i18n.t('bag.cat.heal'))
    expect(filterOptions(options, 'potion')[0]!.value).toBe('potion')
    // The other language's name finds it too (Super Ball is the Spanish name of the Great Ball).
    expect(filterOptions(options, 'super ball')[0]!.value).toBe('great-ball')
    expect(filterOptions(options, 'great-b')[0]!.value).toBe('great-ball')
    expect(filterOptions(options, 'golden')[0]!.value).toBe('golden-feather')
    expect(filterOptions(options, 'zzzzzz')).toEqual([])
  })

  it('the item picker renders with the stored slug resolved to its name', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(<ItemCombobox label="Item" value="potion" onChange={() => undefined} own={[]} />)
    expect(html).toContain('value="Potion"')
    const own = renderToStaticMarkup(<ItemCombobox label="Item" value="golden-feather" onChange={() => undefined} own={['golden-feather']} />)
    expect(own).toContain('value="golden-feather"')
  })
})
