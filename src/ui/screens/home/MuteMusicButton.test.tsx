/** Render test of the mute button in both phases (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../../../audio'
import i18n from '../../../i18n'
import { MuteMusicButtonView } from './MuteMusicButton'

const render = (phase: 'focus' | 'break', patch: Partial<AudioSettings> = {}) =>
  renderToStaticMarkup(<MuteMusicButtonView phase={phase} settings={{ ...DEFAULT_AUDIO_SETTINGS, ...patch }} onPatch={() => undefined} />)
const pressed = (html: string) => html.includes('aria-pressed="true"')

describe('MuteMusicButton', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`labels the button and explains what it mutes in each phase (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const label = lng === 'es' ? 'Música' : 'Music'
      const focus = render('focus')
      const rest = render('break')
      expect(focus).toContain(label)
      expect(rest).toContain(label)
      expect(focus).toContain(i18n.t('focus.muteMusicHint'))
      expect(rest).toContain(i18n.t('break.muteMusicHint'))
      expect(rest).not.toContain(i18n.t('focus.muteMusicHint'))
    })
  }

  it('the session button reads only music during focus', () => {
    expect(pressed(render('focus'))).toBe(false)
    expect(pressed(render('focus', { musicDuringBreak: false }))).toBe(false)
    expect(pressed(render('focus', { musicDuringFocus: false }))).toBe(true)
  })

  it('the break button reads only music during breaks', () => {
    expect(pressed(render('break'))).toBe(false)
    expect(pressed(render('break', { musicDuringFocus: false }))).toBe(false)
    expect(pressed(render('break', { musicDuringBreak: false }))).toBe(true)
  })

  it('a global mute or a zero music volume shows both buttons as muted', () => {
    for (const patch of [{ muted: true }, { music: 0 }, { enabled: false }]) {
      expect(pressed(render('focus', patch))).toBe(true)
      expect(pressed(render('break', patch))).toBe(true)
    }
  })
})
