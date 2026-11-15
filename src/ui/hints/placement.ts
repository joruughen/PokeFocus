export type HintSide = 'top' | 'bottom' | 'left' | 'right'

export interface HintBox {
  top: number
  left: number
  right: number
  bottom: number
}

export interface HintPlacementOptions {
  /** Distance between the anchor and the bubble (the arrow). */
  gap?: number
  /** Minimum margin to the viewport edges. */
  pad?: number
  /** Pixels at the bottom of the viewport covered by fixed UI (the phone's navigation bar). */
  bottomInset?: number
}

const OPPOSITE: Record<HintSide, HintSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * Side of the anchor where a bubble of `size` fits entirely inside the viewport, trying the
 * preferred side, then its opposite, then the other axis. `null` when no side has room (a very tall
 * anchor, or one that is off screen): the caller docks the bubble in a corner instead, so a hint
 * is never cut off by the screen edge.
 */
export function pickHintSide(
  anchor: HintBox,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  preferred: HintSide,
  { gap = 14, pad = 16, bottomInset = 0 }: HintPlacementOptions = {},
): HintSide | null {
  const usableH = viewport.height - bottomInset
  // Hidden (0×0) or off screen: nothing to point at.
  if (anchor.right - anchor.left <= 0 && anchor.bottom - anchor.top <= 0) return null
  if (anchor.bottom < 0 || anchor.top > usableH || anchor.right < 0 || anchor.left > viewport.width) return null
  const room: Record<HintSide, number> = {
    top: anchor.top - pad,
    bottom: usableH - anchor.bottom - pad,
    left: anchor.left - pad,
    right: viewport.width - anchor.right - pad,
  }
  const fits = (s: HintSide) => {
    if (s === 'top' || s === 'bottom') return room[s] >= size.height + gap
    // Beside the anchor the bubble must also fit vertically in the viewport.
    return room[s] >= size.width + gap && size.height <= usableH - 2 * pad
  }
  const vertical = preferred === 'top' || preferred === 'bottom'
  const order: HintSide[] = vertical
    ? [preferred, OPPOSITE[preferred], 'right', 'left']
    : [preferred, OPPOSITE[preferred], 'bottom', 'top']
  return order.find(fits) ?? null
}
