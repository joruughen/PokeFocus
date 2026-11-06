/** Changelog hygiene: well-formed entries, in order, in both languages, and the version in sync with package.json. */
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import pkg from '../../../package.json'
import { CHANGELOG } from './entries'
import { APP_VERSION, RELEASE_STAGE } from './release'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function cmp(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!
  return 0
}

describe('changelog', () => {
  it('has well-formed versions, newest first', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    for (const e of CHANGELOG) expect(e.version).toMatch(SEMVER)
    for (let i = 1; i < CHANGELOG.length; i++) expect(cmp(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0)
  })

  it('has real, non-increasing dates', () => {
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(e.date)
    }
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true)
  })

  it('writes every entry and item in Spanish and English', () => {
    for (const e of CHANGELOG) {
      expect(e.title.es.trim()).not.toBe('')
      expect(e.title.en.trim()).not.toBe('')
      expect(e.items.length).toBeGreaterThan(0)
      for (const item of e.items) {
        expect(['new', 'improved', 'fixed']).toContain(item.kind)
        expect(item.text.es.trim()).not.toBe('')
        expect(item.text.en.trim()).not.toBe('')
        expect(item.text.es).not.toBe(item.text.en)
      }
    }
  })

  it('keeps package.json in step with the newest entry', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('has texts for the current stage and for the other one, in both languages', () => {
    expect(['alpha', 'beta']).toContain(RELEASE_STAGE)
    for (const locale of [es, en]) {
      for (const stage of ['alpha', 'beta'] as const) {
        const s = locale.release[stage]
        for (const k of ['label', 'title', 'tip', 'body'] as const) expect(s[k].trim()).not.toBe('')
      }
    }
  })
})
