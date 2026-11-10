import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { CHANGELOG, type ChangelogEntry } from './entries'
import { WhatsNewBody } from './WhatsNewDialog'
import { compareVersions, decideWhatsNew, unseenEntries, type WhatsNewContext } from './whatsNew'

const entry = (version: string): ChangelogEntry => ({
  version,
  date: '2026-11-01',
  title: { es: `Título ${version}`, en: `Title ${version}` },
  items: [
    { kind: 'new', text: { es: `Nuevo ${version}`, en: `New ${version}` } },
    { kind: 'fixed', text: { es: `Arreglo ${version}`, en: `Fix ${version}` } },
  ],
})
const LOG = [entry('0.7.0'), entry('0.6.1'), entry('0.6.0'), entry('0.5.0')]

const calm: WhatsNewContext = { lastSeen: '0.6.0', current: '0.7.0', studying: false, hintOpen: false, otherDialogOpen: false, onChangelog: false }

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0)
    expect(compareVersions('0.6.1', '0.7.0')).toBe(-1)
    expect(compareVersions('0.7', '0.7.0')).toBe(0)
  })
})

describe('unseenEntries', () => {
  it('returns the entries newer than the last seen version, newest first', () => {
    expect(unseenEntries(LOG, '0.6.0').map((e) => e.version)).toEqual(['0.7.0', '0.6.1'])
    expect(unseenEntries(LOG, '0.5.0').map((e) => e.version)).toEqual(['0.7.0', '0.6.1', '0.6.0'])
  })
  it('returns nothing when up to date, ahead, or never recorded', () => {
    expect(unseenEntries(LOG, '0.7.0')).toEqual([])
    expect(unseenEntries(LOG, '0.8.0')).toEqual([])
    expect(unseenEntries(LOG, null)).toEqual([])
  })
  it('also works with the real changelog', () => {
    expect(unseenEntries(CHANGELOG, CHANGELOG[CHANGELOG.length - 1]!.version).length).toBe(CHANGELOG.length - 1)
  })
})

describe('decideWhatsNew', () => {
  it('shows a new version at a calm moment', () => {
    expect(decideWhatsNew(calm)).toBe('show')
  })
  it('does nothing when the version was already seen (or the player is ahead)', () => {
    expect(decideWhatsNew({ ...calm, lastSeen: '0.7.0' })).toBe('none')
    expect(decideWhatsNew({ ...calm, lastSeen: '0.8.0' })).toBe('none')
  })
  it('only records the version for a new player (never shows)', () => {
    expect(decideWhatsNew({ ...calm, lastSeen: null })).toBe('record')
    expect(decideWhatsNew({ ...calm, lastSeen: null, studying: true })).toBe('record')
  })
  it('waits during an active study session', () => {
    expect(decideWhatsNew({ ...calm, studying: true })).toBe('wait')
  })
  it('waits while a Profe Pika hint or another dialog is open', () => {
    expect(decideWhatsNew({ ...calm, hintOpen: true })).toBe('wait')
    expect(decideWhatsNew({ ...calm, otherDialogOpen: true })).toBe('wait')
  })
  it('shows once the obstacle is gone', () => {
    expect(decideWhatsNew({ ...calm, studying: true })).toBe('wait')
    expect(decideWhatsNew({ ...calm, studying: false })).toBe('show')
  })
  it('covers several skipped versions the same way', () => {
    expect(decideWhatsNew({ ...calm, lastSeen: '0.4.0' })).toBe('show')
  })
  it('counts the news page as seen when the player is already there', () => {
    expect(decideWhatsNew({ ...calm, onChangelog: true })).toBe('record')
  })
})

describe('WhatsNewBody', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows the latest entry with kind tags and the older-versions note (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<WhatsNewBody entries={unseenEntries(LOG, '0.5.0')} />)
      expect(html).not.toMatch(/\b(changelog|whatsNew)\.[a-zA-Z]/)
      expect(html).toContain('0.7.0')
      expect(html).toContain(lng === 'es' ? 'Título 0.7.0' : 'Title 0.7.0')
      expect(html).toContain(lng === 'es' ? 'Nuevo 0.7.0' : 'New 0.7.0')
      expect(html).toContain(lng === 'es' ? 'Corregido' : 'Fixed')
      expect(html).not.toContain('0.6.1')
      expect(html).toContain(lng === 'es' ? 'y 2 versiones más' : 'and 2 more versions')
      expect(html.match(/<time /g)).toHaveLength(1)
    })
    it(`has no older-versions note for a single entry (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<WhatsNewBody entries={[entry('0.7.0')]} />)
      expect(html).not.toMatch(/versi[oó]n(es)? m[aá]s|more versions?/)
    })
  }
})
