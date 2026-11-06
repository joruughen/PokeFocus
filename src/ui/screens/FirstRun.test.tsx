/** Render smoke test of the starter cards of the first run: role tag + one-line body (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { defaultContext } from '../../engine'
import { FirstRun, StarterCard } from './FirstRun'

const ctx = defaultContext()

describe('FirstRun starter cards', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`each starter shows its role as the outlined tag plus the one-line body, outside the radio button (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      for (const slug of ctx.config.starters) {
        const role = ctx.speciesBySlug.get(slug)!.role ?? 'allrounder'
        const name = i18n.t(`roles.${role}.name`)
        const html = renderToStaticMarkup(<StarterCard slug={slug} checked={false} tabbable onPick={() => {}} />)
        expect(html, slug).not.toMatch(/roles?\.[a-z]|roleInfo\./) // no raw i18n keys
        expect(html).toContain(`aria-label="${i18n.t('roleInfo.aria', { name })}"`)
        expect(html).toContain(i18n.t(`roles.${role}.body`).replace(/'/g, '&#x27;'))
        // Dark card: the dark-surface frame, no "Rol" prefix (small size).
        expect(html).toContain('border-mist-300')
        expect(html).not.toContain(`>${i18n.t('roleInfo.prefix')}<`)
        // Buttons cannot nest: the radio closes before the role tag opens, and there is exactly one radio.
        expect(html.match(/role="radio"/g)).toHaveLength(1)
        expect(html.indexOf('</button>')).toBeLessThan(html.indexOf(`aria-label="${i18n.t('roleInfo.aria', { name })}"`))
        expect(html.match(/<button/g)).toHaveLength(2)
      }
    })
  }

  it('the first step still renders (language and time zone), with no raw keys', async () => {
    await i18n.changeLanguage('es')
    const html = renderToStaticMarkup(<FirstRun />)
    expect(html).not.toMatch(/firstRun\./)
    expect(html).toContain(i18n.t('firstRun.timezone'))
  })
})
