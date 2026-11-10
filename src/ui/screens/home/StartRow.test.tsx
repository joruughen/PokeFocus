/** The solo Start button while a study-group room is open (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { StartRow } from './StartRow'

const render = (inGroup: boolean, busy = false) => renderToStaticMarkup(<StartRow minutes={25} busy={busy} inGroup={inGroup} onStart={() => undefined} />)
/** The attribute, not the `disabled:` utility classes. */
const DISABLED = / disabled=""/
const text = (key: string) => i18n.t(key).replace(/'/g, '&#x27;')
const button = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? ''

describe('StartRow', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`is enabled with the normal note when no room is open (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render(false)
      expect(button(html)).not.toMatch(DISABLED)
      expect(html).toContain(text('home.plan.startNote'))
      expect(html).not.toContain(text('home.plan.startInGroup'))
    })

    it(`is disabled and explains why while a group room is open (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render(true)
      expect(button(html)).toMatch(DISABLED)
      expect(button(html)).toContain('aria-describedby="start-note"')
      expect(html).toContain(text('home.plan.startInGroup'))
      expect(html).not.toContain(text('home.plan.startNote'))
      expect(i18n.t('home.plan.startInGroup')).not.toBe('home.plan.startInGroup')
    })
  }

  it('is disabled while busy, whatever the room', () => {
    expect(button(render(false, true))).toMatch(DISABLED)
  })
})
