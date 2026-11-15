import { Popover } from '@base-ui/react/popover'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Mascot } from '../components/Mascot'
import { sfx } from '../lib/sound'
import { usePrefs } from '../store/prefs'
import { anchorFocused, closeHint, disableTips, getHint, nextInSequence, useHints } from './engine'
import { pickHintSide, type HintSide } from './placement'

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0
}

/**
 * The element carrying the anchor id. Several can exist (the desktop rail's items are hidden on
 * phones, where the same section sits in the «More» sheet): prefer one that is on screen. A section
 * of the nav that is not on screen at all points at the «More» button instead.
 */
function findAnchor(id: string | undefined): Element | null {
  if (!id) return null
  const all = [...document.querySelectorAll(`[data-hint-anchor="${CSS.escape(id)}"]`)]
  const shown = all.find(visible)
  if (shown) return shown
  if (id.startsWith('nav.') && id !== 'nav.more' && all.length > 0) {
    const more = document.querySelector('[data-hint-anchor="nav.more"]')
    if (more && visible(more)) return more
  }
  return all[0] ?? null
}

/**
 * Renders the active hint as a speech bubble from the mascot, anchored to the
 * hint's element (or docked bottom-right when there is none). Mount once.
 */
export function HintLayer() {
  const { t } = useTranslation()
  const active = useHints((s) => s.active)
  const tipsEnabled = usePrefs((s) => s.tipsEnabled)
  const def = active ? getHint(active.id) : undefined
  const [anchor, setAnchor] = useState<Element | null>(null)
  const [ready, setReady] = useState(false)
  // Side of the anchor where the bubble fits on screen; null = dock it in the corner instead; undefined = not measured yet.
  const [side, setSide] = useState<HintSide | null | undefined>(undefined)
  const [popupEl, setPopupEl] = useState<HTMLElement | null>(null)

  // Focus/hover triggers.
  useEffect(() => {
    const onIn = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-hint-anchor]')
      const id = el?.getAttribute('data-hint-anchor')
      if (id) anchorFocused(id)
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('pointerover', onIn)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('pointerover', onIn)
    }
  }, [])

  // Wait (briefly) for the anchor to be on screen, then highlight it.
  useEffect(() => {
    setReady(false)
    setAnchor(null)
    if (!active || !def) return
    let frame = 0
    let tries = 0
    const look = () => {
      const el = findAnchor(def.anchor) ?? (active.manual ? active.fallbackAnchor : null)
      if (el || tries > 90) {
        setAnchor(el)
        setReady(true)
        return
      }
      tries++
      frame = requestAnimationFrame(look)
    }
    look()
    return () => cancelAnimationFrame(frame)
  }, [active, def])

  useEffect(() => {
    if (ready && !anchor && active && !active.manual) sfx('hintPop')
  }, [ready, anchor, active])

  // The anchor can be replaced by a re-render (a wild card updating, a list re-keying): a detached
  // element measures as 0×0 at (0,0) and the bubble jumped to the top-left corner. Follow the new
  // element with the same anchor id, or dock the bubble when there is none.
  useEffect(() => {
    if (!anchor || !ready || !def) return
    const id = window.setInterval(() => {
      if (anchor.isConnected) return
      setAnchor(findAnchor(def.anchor) ?? (active?.manual ? (active.fallbackAnchor?.isConnected ? active.fallbackAnchor : null) : null))
    }, 250)
    return () => window.clearInterval(id)
  }, [anchor, ready, def, active])

  // General rule: the bubble always fits on screen. Pick a side of the anchor with room for the
  // bubble's measured size (preferred side, its opposite, then left/right); when none has room (a
  // very tall anchor such as the team card on a phone, or an anchor scrolled out of view) dock the
  // bubble at the bottom-right corner. Re-evaluated on scroll, resize and when the bubble resizes.
  const preferred = def?.side ?? 'bottom'
  useEffect(() => {
    if (!anchor || !ready) {
      setSide(undefined)
      return
    }
    let frame = 0
    const decide = () => {
      frame = 0
      if (!anchor.isConnected) return
      const r = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const pr = popupEl?.getBoundingClientRect()
      const size = { width: pr?.width || Math.min(432, vw - 32), height: pr?.height || 240 }
      setSide(pickHintSide(r, { width: vw, height: window.innerHeight }, size, preferred, { bottomInset: bottomBarInset() }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(decide)
    }
    decide()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (ro && popupEl) ro.observe(popupEl)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      ro?.disconnect()
    }
  }, [anchor, ready, preferred, popupEl])

  // Sound and scroll once per hint: a re-found anchor (see below) must not yank the page again.
  const announced = useRef<string | null>(null)
  useEffect(() => {
    if (!anchor || !ready) return
    anchor.setAttribute('data-hint-active', '')
    if (!active?.manual && announced.current !== active?.id) {
      announced.current = active?.id ?? null
      sfx('hintPop')
      anchor.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    return () => anchor.removeAttribute('data-hint-active')
  }, [anchor, ready, active?.manual, active?.id])

  if (!active || !def || !ready) return null
  const step = active.step
  const isLast = !step || step.index >= step.total - 1
  const title = t(`hints.${active.id}.title`, active.values)
  const body = t(`hints.${active.id}.body`, active.values)

  const bubble = (
    <div className="flex gap-3">
      <Mascot pose={def.pose ?? 'point'} size={96} className="-my-2 -ml-2 shrink-0 self-end" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg leading-tight text-ink">{title}</p>
          {step && (
            <span className="shrink-0 font-num text-lg leading-none text-dusk-500" aria-label={t('hint.step', { n: step.index + 1, total: step.total })}>
              {step.index + 1}/{step.total}
            </span>
          )}
        </div>
        <p className="mt-1 text-[0.9375rem] leading-snug text-dusk-800">{body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {step && !isLast ? (
            <Button size="sm" onClick={nextInSequence}>
              {t('hint.next')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => closeHint(true)}>
              {t('hint.gotIt')}
            </Button>
          )}
          {!active.manual && tipsEnabled && (
            <button type="button" onClick={disableTips} className="px-2 text-sm text-dusk-600 underline underline-offset-2 hover:text-ink">
              {t('hint.disable')}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  const popupClass =
    'relative w-[min(27rem,calc(100vw-2rem))] bg-mist-50 p-4 shadow-plate outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[var(--ease-snap)] data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:opacity-0'

  return (
    <Popover.Root
      open
      onOpenChange={(open, details) => {
        // Escape or the close button → seen. Outside clicks leave it open: the
        // bubble is non-modal and should not vanish while the user explores.
        if (!open && details.reason !== 'outside-press') closeHint(true)
      }}
    >
      <Popover.Portal>
        {anchor && side !== null ? (
          <Popover.Positioner anchor={anchor} side={side ?? preferred} sideOffset={14} collisionPadding={16} className="z-[45]">
            <Popover.Popup ref={setPopupEl} className={popupClass} initialFocus={false} finalFocus={false} aria-live="polite">
              <Popover.Arrow className="data-[side=bottom]:-top-[12px] data-[side=left]:-right-[17px] data-[side=left]:rotate-90 data-[side=right]:-left-[17px] data-[side=right]:-rotate-90 data-[side=top]:-bottom-[12px] data-[side=top]:rotate-180">
                <svg viewBox="0 0 11 6" width={22} height={12} shapeRendering="crispEdges" aria-hidden className="block">
                  <path d="M4 0h3v1h1v1h1v1h1v1h1v2H0V4h1V3h1V2h1V1h1z" fill="var(--color-ink)" />
                  <path d="M5 1h1v1h1v1h1v1h1v2H2V4h1V3h1V2h1z" fill="var(--color-mist-50)" />
                </svg>
              </Popover.Arrow>
              {bubble}
            </Popover.Popup>
          </Popover.Positioner>
        ) : (
          <Popover.Positioner anchor={dockAnchor} side="top" align="end" sideOffset={0} collisionPadding={16} className="z-[45]">
            <Popover.Popup ref={setPopupEl} className={popupClass} initialFocus={false} finalFocus={false} aria-live="polite">
              {bubble}
            </Popover.Popup>
          </Popover.Positioner>
        )}
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Height of the phone's fixed bottom navigation bar (below 640 px), which the bubble must not cover. */
function bottomBarInset(): number {
  return typeof window !== 'undefined' && window.innerWidth < 640 ? 64 : 0
}

/** Virtual anchor at the bottom-right corner (docked bubble), above the phone's bottom bar. */
const dockAnchor = {
  getBoundingClientRect: () => {
    const x = window.innerWidth - (window.innerWidth < 640 ? 16 : 24)
    const y = window.innerHeight - 24 - bottomBarInset()
    return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y, toJSON: () => ({}) } as DOMRect
  },
}
