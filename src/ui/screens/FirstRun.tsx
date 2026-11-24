import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, toLocal } from '../../engine'
import type { Locale } from '../../i18n'
import { Button, Logo, Mascot, type MascotPose, Platform, RoleBadge, Segmented, Select, Sprite, Stage, toast, TypeBadge } from '../components'
import { timeOfDay } from '../lib/conditions'
import { cx } from '../lib/cx'
import { allTimeZones, browserTimeZone } from '../lib/format'
import { useNames } from '../lib/names'
import { errorText } from '../lib/errors'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'
import { usePrefs } from '../store/prefs'
import { useContent } from '../store/content'
import { SHOWCASE_GAMMA } from '../lib/spriteSize'

/**
 * First run: language and time zone → your first partner → how it works (3 steps).
 * The trainer name and country come from the account (chosen at registration).
 */
export function FirstRun() {
  const STARTERS = useContent().config.starters
  const { t } = useTranslation()
  const names = useNames()
  const locale = usePrefs((s) => s.locale)
  const setLocale = usePrefs((s) => s.setLocale)
  const createPlayer = useGame((s) => s.createPlayer)
  const [step, setStep] = useState(0)
  const trainerName = useAuth((s) => s.user?.trainerName ?? '')
  const busy = useGame((s) => s.pending > 0)
  const [tz, setTz] = useState(browserTimeZone())
  const [starter, setStarter] = useState<string | null>(null)
  const zones = useMemo(() => allTimeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [])
  const hour = toLocal(Date.now(), tz).hour
  const canNext = step === 1 ? starter !== null : true

  const speech: { pose: MascotPose; text: string }[] = [
    { pose: 'idle', text: t('firstRun.speech.0', { name: trainerName || t('firstRun.you') }) },
    { pose: 'point', text: t('firstRun.speech.1', { name: trainerName || t('firstRun.you') }) },
    { pose: 'cheer', text: t('firstRun.speech.2', { starter: starter ? names.species(starter) : '' }) },
  ]
  const s = speech[step]!

  const finish = async () => {
    if (!starter || busy) return
    const ok = await createPlayer({ locale, timezone: tz, starterSlug: starter })
    if (!ok) toast.add({ title: errorText(useGame.getState().error ?? 'generic'), type: 'danger' })
  }

  return (
    <div className="min-h-dvh bg-dusk-950">
      <Stage time={timeOfDay(hour)} weather="clear" className="h-56 shadow-none">
        <div className="mx-auto flex h-full max-w-5xl items-start px-6 pt-6">
          <Logo height={48} />
        </div>
      </Stage>

      <main className="relative mx-auto -mt-24 max-w-5xl px-6 pb-16">
        <div className="mb-6 flex items-end gap-4">
          <Mascot pose={s.pose} size={144} className="shrink-0" />
          <p key={step} aria-live="polite" className="relative mb-8 max-w-xl animate-pop-in bg-mist-50 px-4 py-3 text-lg text-ink shadow-raised">
            <SpeechTail />
            {s.text}
          </p>
        </div>

        <section className="bg-dusk-800 p-6 shadow-plate md:p-8" aria-labelledby="fr-title">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 id="fr-title" className="text-2xl">
              {t(`firstRun.steps.${step}`)}
            </h1>
            <ol className="flex items-center gap-2" aria-label={t('firstRun.progress', { n: step + 1, total: 3 })}>
              {[0, 1, 2].map((i) => (
                <li key={i} aria-current={i === step ? 'step' : undefined} className={cx('h-3 shadow-frame transition-[width]', i === step ? 'w-10 bg-volt-400' : i < step ? 'w-5 bg-mist-300' : 'w-5 bg-dusk-600')}>
                  <span className="sr-only">{t(`firstRun.steps.${i}`)}</span>
                </li>
              ))}
            </ol>
          </div>

          {step === 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="font-display text-base text-mist-300" id="fr-lang">
                  {t('firstRun.language')}
                </span>
                <Segmented<Locale>
                  label={t('firstRun.language')}
                  value={locale}
                  onChange={setLocale}
                  options={[
                    { value: 'es', label: 'Español' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </div>
              <div>
                <Select label={t('firstRun.timezone')} options={zones} value={tz} onChange={setTz} />
                <p className="mt-1.5 text-sm text-mist-400">{t('firstRun.timezoneNote')}</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div
              role="radiogroup"
              aria-label={t('firstRun.steps.1')}
              className="grid gap-5 md:grid-cols-3"
              // Radio-group keyboard pattern: arrows move the selection, Tab enters/leaves the group once.
              onKeyDown={(e) => {
                const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                if (!dir) return
                e.preventDefault()
                const from = starter ? STARTERS.indexOf(starter) : dir > 0 ? -1 : 0
                const to = STARTERS[(from + dir + STARTERS.length) % STARTERS.length]!
                setStarter(to)
                requestAnimationFrame(() => e.currentTarget.querySelector<HTMLElement>(`[data-starter="${to}"]`)?.focus())
              }}
            >
              {STARTERS.map((slug, i) => (
                <StarterCard key={slug} slug={slug} checked={starter === slug} tabbable={starter ? starter === slug : i === 0} onPick={() => setStarter(slug)} />
              ))}
            </div>
          )}

          {step === 2 && (
            <ol className="grid gap-5 md:grid-cols-3">
              <LoopStep n={1} title={t('firstRun.loop.study.title')} body={t('firstRun.loop.study.body')} icon={<span className="font-num text-5xl leading-none text-volt-400">25:00</span>} />
              <LoopStep n={2} title={t('firstRun.loop.claim.title')} body={t('firstRun.loop.claim.body')} icon={<Mascot pose="cheer" size={48} />} />
              <LoopStep
                n={3}
                title={t('firstRun.loop.catch.title')}
                body={t('firstRun.loop.catch.body')}
                icon={<Sprite kind="item" slug="poke-ball" scale={2} alt="" />}
              />
            </ol>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
 <Button variant="ghost" icon="back" onClick={() => setStep((n) => Math.max(0, n - 1))} className={step === 0 ? 'invisible' : ''}>
              {t('common.back')}
            </Button>
            {step < 2 ? (
              <Button size="lg" icon="next" disabled={!canNext} onClick={() => setStep((n) => n + 1)}>
                {t('common.continue')}
              </Button>
            ) : (
              <Button size="lg" icon="play" onClick={() => void finish()} disabled={busy}>
                {t('firstRun.finish')}
              </Button>
            )}
          </div>
        </section>
        <p className="mt-6 text-center text-xs text-mist-400">{t('app.disclaimer')}</p>
      </main>
    </div>
  )
}

/** Pixel tail on the left of a speech bubble, pointing at the mascot. */
function SpeechTail() {
  return (
    <svg viewBox="0 0 6 6" width={18} height={18} shapeRendering="crispEdges" aria-hidden className="absolute bottom-3 -left-[16px]">
      <path d="M6 0v6H5V5H4V4H3V3H2V2H1V1H0V0z" fill="var(--color-ink)" />
      <path d="M6 1v4H5V4H4V3H3V2H2V1z" fill="var(--color-mist-50)" />
    </svg>
  )
}

function LoopStep({ n, title, body, icon }: { n: number; title: string; body: string; icon: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 bg-dusk-900 p-5 inset-shadow-well">
      <div className="flex h-16 items-center justify-between">
        {icon}
        <span className="font-num text-3xl leading-none text-mist-400" aria-hidden>
          {n}
        </span>
      </div>
      <h2 className="text-lg">{title}</h2>
      <p className="text-sm text-mist-300">{body}</p>
    </li>
  )
}

/**
 * One starter. The radio is the button over the sprite, name and types; the role tag (a button
 * of its own, with a help popover) sits below it, outside the radio, because buttons cannot nest.
 * Clicking the role row still picks the card.
 */
export function StarterCard({ slug, checked, tabbable, onPick }: { slug: string; checked: boolean; tabbable: boolean; onPick: () => void }) {
  const ctx = defaultContext()
  const { t } = useTranslation()
  const names = useNames()
  const sp = ctx.speciesBySlug.get(slug)!
  const role = sp.role ?? 'allrounder'
  return (
    <div
      className={cx(
        'group flex flex-col items-stretch text-left shadow-raised transition-[translate,background-color] duration-100',
        checked ? 'translate-y-[3px] bg-dusk-600 shadow-pressed outline-3 outline-offset-4 outline-volt-400' : 'bg-dusk-700 hover:bg-dusk-600',
      )}
    >
      <button type="button" role="radio" aria-checked={checked} tabIndex={tabbable ? 0 : -1} data-starter={slug} onClick={onPick} className="flex flex-col items-stretch text-left">
        <Stage time="day" weather="clear" celestial={false} className="h-44 shadow-none">
          <div className="relative flex h-full items-end justify-center pb-3">
            <Platform width={128} className="absolute bottom-3" />
            <Sprite kind="showdown" slug={slug} box={{ height: 132, width: 180, gamma: SHOWCASE_GAMMA }} alt={names.species(slug)} className={cx('relative mb-3', checked && 'motion-safe:animate-bob')} />
          </div>
        </Stage>
        <span className="flex items-center justify-between gap-2 px-4 pt-4">
          <span className="font-display text-xl">{names.species(slug)}</span>
          <span className="flex gap-1">
            {sp.types.map((ty) => (
              <TypeBadge key={ty} type={ty} />
            ))}
          </span>
        </span>
      </button>
      {/* The click handler is a mouse convenience; the radio above is the accessible control. */}
      <div className="flex flex-1 flex-col items-start gap-2 p-4 pt-2" onClick={onPick}>
        <span onClick={(e) => e.stopPropagation()}>
          <RoleBadge role={role} />
        </span>
        <p className="text-sm text-mist-300">{t(`roles.${role}.body`)}</p>
      </div>
    </div>
  )
}
