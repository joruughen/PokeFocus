import { describe, expect, it } from 'vitest'
import { EMPTY_DOC, GIFT_MESSAGE_MAX, type GameDoc } from './protocol'
import { ADMIN_GRANT_LIMITS, applyAdminGrant, checkAdminGrant } from './admin'
import { applyAction } from './actions'
import { createRng } from '../engine'

function docWithPlayer(): GameDoc {
  const r = applyAction(EMPTY_DOC, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'squirtle' }, { now: 1_000_000, rng: createRng('t'), dev: false, trainerName: 'T' })
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

describe('applyAdminGrant', () => {
  const doc = docWithPlayer()

  it('adds items and dust without touching anything else, and leaves the input alone', () => {
    const snapshot = JSON.stringify(doc)
    const r = applyAdminGrant(doc, { items: { 'great-ball': 3, potion: 2 }, dust: 50 })
    if (!r.ok) throw new Error(r.error)
    const p = doc.player!
    expect(r.doc.player!.dust).toBe(p.dust + 50)
    expect(r.doc.player!.inventory['great-ball']).toBe((p.inventory['great-ball'] ?? 0) + 3)
    expect(r.doc.player!.inventory.potion).toBe((p.inventory.potion ?? 0) + 2)
    expect({ ...r.doc.player!, dust: p.dust, inventory: p.inventory }).toEqual(p)
    expect(r.applied).toEqual({ items: { 'great-ball': 3, potion: 2 }, dust: 50 })
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('dust or items alone are fine', () => {
    expect(applyAdminGrant(doc, { dust: 1 }).ok).toBe(true)
    expect(applyAdminGrant(doc, { items: { potion: 1 } }).ok).toBe(true)
  })

  it('no player', () => {
    expect(applyAdminGrant(EMPTY_DOC, { dust: 1 })).toEqual({ ok: false, error: 'no_player' })
  })

  it('validates caps and the catalogue', () => {
    const { maxPerItem, maxDust, maxItemKinds } = ADMIN_GRANT_LIMITS
    expect(checkAdminGrant({})).toBe('empty_grant')
    expect(checkAdminGrant({ items: {} })).toBe('empty_grant')
    expect(checkAdminGrant({ items: { nope: 1 } })).toBe('unknown_item')
    for (const n of [0, -1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) expect(checkAdminGrant({ items: { potion: n } }), String(n)).toBe('invalid_amount')
    expect(checkAdminGrant({ dust: 0 })).toBe('invalid_amount')
    expect(checkAdminGrant({ dust: -5 })).toBe('invalid_amount')
    expect(checkAdminGrant({ items: { potion: maxPerItem + 1 } })).toBe('amount_too_large')
    expect(checkAdminGrant({ dust: maxDust + 1 })).toBe('amount_too_large')
    expect(checkAdminGrant({ items: { potion: maxPerItem }, dust: maxDust })).toBeNull()
    const many = Object.fromEntries(Array.from({ length: maxItemKinds + 1 }, (_, i) => [`x${i}`, 1]))
    expect(checkAdminGrant({ items: many })).toBe('too_many_items')
    expect(applyAdminGrant(doc, { items: { potion: -3 } })).toEqual({ ok: false, error: 'invalid_amount' })
  })

  it('a message queues a gift window entry (items, dust, message, at); no message adds nothing', () => {
    const silent = applyAdminGrant(doc, { dust: 5 })
    if (!silent.ok) throw new Error(silent.error)
    expect(silent.doc.player!.pendingGifts).toBeUndefined()
    const r = applyAdminGrant(doc, { items: { potion: 2 }, dust: 5, message: { es: 'Hola', en: 'Hi' }, at: 99 })
    if (!r.ok) throw new Error(r.error)
    expect(r.doc.player!.pendingGifts).toEqual([{ items: { potion: 2 }, dust: 5, message: { es: 'Hola', en: 'Hi' }, at: 99 }])
    expect(doc.player!.pendingGifts).toBeUndefined()
    // Older entries are kept, up to the cap (the oldest go first).
    let cur = doc
    for (let i = 0; i < ADMIN_GRANT_LIMITS.maxPendingGifts + 2; i++) {
      const n = applyAdminGrant(cur, { dust: 1, message: { en: `m${i}` }, at: i })
      if (!n.ok) throw new Error(n.error)
      cur = n.doc
    }
    expect(cur.player!.pendingGifts).toHaveLength(ADMIN_GRANT_LIMITS.maxPendingGifts)
    expect(cur.player!.pendingGifts![0]!.at).toBe(2)
  })

  it('validates the message: plain text, es/en only, within the limit', () => {
    expect(checkAdminGrant({ dust: 1, message: { es: 'ok' } })).toBeNull()
    for (const message of [{}, { es: '' }, { es: '<b>x</b>' }, { en: 'a\nb' }, { es: 'x'.repeat(GIFT_MESSAGE_MAX + 1) }, { fr: 'x' } as never]) {
      expect(checkAdminGrant({ dust: 1, message }), JSON.stringify(message)).toBe('invalid_message')
    }
  })
})
