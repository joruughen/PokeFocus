import { describe, expect, it } from 'vitest'
import { pickHintSide } from './placement'

const vp = { width: 390, height: 844 }
const bubble = { width: 358, height: 230 }
const box = (top: number, bottom: number, left = 16, right = 374) => ({ top, bottom, left, right })

describe('pickHintSide', () => {
  it('keeps the preferred side when the bubble fits', () => {
    expect(pickHintSide(box(100, 200), vp, bubble, 'bottom')).toBe('bottom')
    expect(pickHintSide(box(500, 600), vp, bubble, 'top')).toBe('top')
  })

  it('flips to the opposite side when the preferred one has no room', () => {
    expect(pickHintSide(box(600, 700), vp, bubble, 'bottom')).toBe('top')
    expect(pickHintSide(box(100, 200), vp, bubble, 'top')).toBe('bottom')
  })

  it('docks (null) for a tall anchor that leaves no room above or below', () => {
    // The home team card at 390 px: ~520 tall, starts at 120.
    expect(pickHintSide(box(120, 640), vp, bubble, 'bottom')).toBeNull()
  })

  it('docks when the anchor is off screen', () => {
    expect(pickHintSide(box(900, 960), vp, bubble, 'top')).toBeNull()
    expect(pickHintSide(box(-300, -10), vp, bubble, 'bottom')).toBeNull()
  })

  it('uses a side when there is horizontal room (wide screens)', () => {
    const wide = { width: 1280, height: 800 }
    const b = { width: 432, height: 230 }
    expect(pickHintSide({ top: 100, bottom: 780, left: 40, right: 400 }, wide, b, 'bottom')).toBe('right')
  })

  it('does not count the phone bottom bar as free space', () => {
    // 20 px of room below the anchor: with the bar's 64 px inset the bubble goes above instead.
    expect(pickHintSide(box(150, 780), vp, bubble, 'bottom', { bottomInset: 64 })).toBeNull()
    expect(pickHintSide(box(300, 480), vp, bubble, 'bottom', { bottomInset: 0 })).toBe('bottom')
    expect(pickHintSide(box(500, 560), vp, bubble, 'bottom', { bottomInset: 64 })).toBe('top')
  })
})
