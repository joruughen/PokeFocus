import { describe, expect, it } from 'vitest'
import { createToastDeduper, MAX_VISIBLE_TOASTS, toastKey } from './Toast'

describe('toast queue helpers', () => {
  it('shows at most 3 toasts at once', () => {
    expect(MAX_VISIBLE_TOASTS).toBe(3)
  })

  it('drops an identical toast fired again inside the window, lets it through afterwards', () => {
    const d = createToastDeduper(1000)
    const key = toastKey({ type: 'success', title: 'Saved', description: 'Team updated' })
    expect(d.check(key, 0)).toBeNull()
    d.remember(key, 't1', 0)
    expect(d.check(key, 500)).toBe('t1')
    expect(d.check(key, 1000)).toBeNull()
  })

  it('different type, title or description are different toasts', () => {
    const d = createToastDeduper(1000)
    d.remember(toastKey({ title: 'A' }), 't1', 0)
    expect(d.check(toastKey({ title: 'B' }), 10)).toBeNull()
    expect(d.check(toastKey({ title: 'A', type: 'danger' }), 10)).toBeNull()
    expect(d.check(toastKey({ title: 'A', description: 'x' }), 10)).toBeNull()
    expect(d.check(toastKey({ title: 'A' }), 10)).toBe('t1')
  })
})
