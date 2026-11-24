import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audio } from '../../../audio'
import { Button, Platform, Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { SHOWCASE_GAMMA } from '../../lib/spriteSize'

/** Alternation times (ms): the two silhouettes swap faster and faster, like the evolution. */
const SWAPS = [0, 420, 780, 1080, 1320, 1520, 1680, 1810, 1910, 1990, 2050, 2100, 2140, 2180, 2210]
const REVEAL = 2450

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The transformation moment: a dark stage where the previous look and the new look flash as
 * white silhouettes, then the new look appears with a burst (same sfx and ducking as the
 * evolution). `from`/`to` are species slugs: going back to the base species (`to === base`)
 * reads as "went back to being X". `base` is the transformer's own species (default Ditto);
 * `nickname` is its nickname. Reduced motion: straight to the reveal.
 */
export function TransformMoment({
  from,
  to,
  shiny,
  nickname,
  base = 'ditto',
  onClose,
}: {
  from: string
  to: string
  shiny: boolean
  nickname?: string | null
  base?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const names = useNames()
  const [showNew, setShowNew] = useState(false)
  const [done, setDone] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (reduceMotion()) {
      setDone(true)
      setShowNew(true)
      sfx('evolveDone')
      return
    }
    audio.setDucking(true)
    sfx('evolveStart')
    SWAPS.forEach((ms, i) => timers.current.push(setTimeout(() => setShowNew(i % 2 === 1), ms)))
    timers.current.push(
      setTimeout(() => {
        setShowNew(true)
        setDone(true)
        sfx('evolveDone')
        audio.setDucking(false)
      }, REVEAL),
    )
    const list = timers.current
    return () => {
      list.forEach(clearTimeout)
      audio.setDucking(false)
    }
  }, [])

  const revert = to === base
  const name = names.pokemon({ speciesSlug: base, nickname })
  const slug = showNew ? to : from
  return (
    <BaseDialog.Root open onOpenChange={(o) => !o && done && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-ink/90" />
        <BaseDialog.Popup className="fixed inset-0 z-50 grid place-items-center p-6 outline-none">
          <div className="flex w-[min(34rem,100%)] flex-col items-center gap-6 text-center">
            <BaseDialog.Title className="font-display text-2xl text-mist-50">
              {done ? t(revert ? 'transform.moment.revertTitle' : 'transform.moment.doneTitle') : t(revert ? 'transform.moment.revertWhatTitle' : 'transform.moment.whatTitle', { name })}
            </BaseDialog.Title>
            <div className="relative flex h-64 w-full items-end justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-dusk-700),var(--color-dusk-950)_70%)] shadow-plate">
              <Platform width={200} night className="absolute bottom-6" />
              {done && <span className="absolute inset-0 m-auto size-56 animate-burst bg-[radial-gradient(circle,var(--color-volt-200)_0_35%,transparent_36%)]" aria-hidden />}
              <Sprite
                key={slug}
                kind="showdown"
                slug={slug}
                shiny={shiny}
                box={{ height: 208, width: 300, gamma: SHOWCASE_GAMMA }}
                alt={names.species(slug)}
                className={cx('relative mb-12', !done && 'brightness-0 invert', done && 'motion-safe:animate-pop-in')}
              />
            </div>
            <BaseDialog.Description className="min-h-14 max-w-[40ch] text-lg text-mist-100" aria-live="polite">
              {done ? t(revert ? 'transform.moment.revertBody' : 'transform.moment.doneBody', { name, to: names.species(to) }) : t('transform.moment.whatBody')}
            </BaseDialog.Description>
            <Button size="lg" icon="check" onClick={onClose} disabled={!done} className={cx(!done && 'invisible')}>
              {t('common.continue')}
            </Button>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
