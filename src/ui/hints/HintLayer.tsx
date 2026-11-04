import { Popover } from '@base-ui/react/popover'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Mascot } from '../components/Mascot'
import { sfx } from '../lib/sound'
import { usePrefs } from '../store/prefs'
import { anchorFocused, closeHint, disableTips, getHint, nextInSequence, useHints } from './engine'

function findAnchor(id: string | undefined): Element | null {
  if (!id) return null
  return document.querySelector(`[data-hint-anchor="${CSS.escape(id)}"]`)
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

  useEffect(() => {
    if (!anchor || !ready) return
    anchor.setAttribute('data-hint-active', '')
    if (!active?.manual) sfx('hintPop')
    if (!active?.manual) anchor.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return () => anchor.removeAttribute('data-hint-active')
  }, [anchor, ready, active?.manual])

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
        {anchor ? (
          <Popover.Positioner anchor={anchor} side={def.side ?? 'bottom'} sideOffset={14} collisionPadding={16} className="z-[45]">
            <Popover.Popup className={popupClass} initialFocus={false} finalFocus={false} aria-live="polite">
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
          <Popover.Positioner anchor={dockAnchor} side="top" align="end" sideOffset={0} className="z-[45]">
            <Popover.Popup className={popupClass} initialFocus={false} finalFocus={false} aria-live="polite">
              {bubble}
            </Popover.Popup>
          </Popover.Positioner>
        )}
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Virtual anchor at the bottom-right corner (docked bubble). */
const dockAnchor = {
  getBoundingClientRect: () => {
    const x = window.innerWidth - 24
    const y = window.innerHeight - 24
    return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y, toJSON: () => ({}) } as DOMRect
  },
}
