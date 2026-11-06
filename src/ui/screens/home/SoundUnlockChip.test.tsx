/** Render test of the "tap to turn sound on" chip (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { SoundUnlockChip, SoundUnlockChipView } from './SoundUnlockChip'

describe('SoundUnlockChip', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows a real button with the copy when sound is locked (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<SoundUnlockChipView show onUnlock={() => undefined} />)
      expect(html).toMatch(/^<button type="button"/)
      expect(html).toContain(lng === 'es' ? 'Toca para activar el sonido' : 'Tap to turn sound on')
      expect(html).toContain('role="status"')
      expect(html).toContain('aria-live="polite"')
    })
  }

  it('renders only the (empty) status region when not needed', () => {
    const html = renderToStaticMarkup(<SoundUnlockChipView show={false} onUnlock={() => undefined} />)
    expect(html).not.toContain('<button')
    expect(html).toMatch(/<span class="sr-only" role="status" aria-live="polite" aria-atomic="true"><\/span>/)
  })

  it('stays hidden without Web Audio (node) whatever the phase', () => {
    expect(renderToStaticMarkup(<SoundUnlockChip />)).not.toContain('<button')
  })
})
