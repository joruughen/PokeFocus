import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BALL_ORDER,
  defaultContext,
  encounterModifiers,
  studyBallMaxLevelFor,
  pokemonView,
  wildCatchChance,
  type Charge,
  type CounterResult,
  type ThrowBall,
  type ThrowOutcome,
  type Wave,
  type WildPokemon,
  type WildRef,
} from '../../../engine'
import { ArtIcon, BallIcon, Button, HelpDot, IvQuality, Panel, Platform, PokemonCard, ProgressBar, Sprite, Stage, StudyBallIcon, toast, Tooltip, TypeBadge } from '../../components'
import { emitHintEvent, hintAnchor, useHintEvent, useHintScreen, useHints } from '../../hints'
import { cx } from '../../lib/cx'
import { fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx, sfxLater } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { usePlayer, useScene } from '../../store/selectors'

const ctx = defaultContext()

type Anim = {
  ref: WildRef
  ball: ThrowBall
  stage: 'throw' | 'wobble' | 'result'
  outcome: ThrowOutcome
  /** The wild as it was before the throw (shown until the result lands). */
  before: WildPokemon
}

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Waves after a claimed session: lower HP shows what your team did; catch with balls. */
export function Waves() {
  useHintScreen('waves')
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const doThrow = useGame((s) => s.throwBall)
  const applyStatus = useGame((s) => s.applyStatus)
  const reroll = useGame((s) => s.reroll)
  const nextWave = useGame((s) => s.nextWave)
  const finishWaves = useGame((s) => s.finishWaves)
  const enc = player.encounter!
  const wave = enc.waves[enc.currentWave]!
  const scene = useScene(player, now)
  const mods = useMemo(() => encounterModifiers(player), [player])
  const studyMax = studyBallMaxLevelFor(player.trainer.level, ctx.config)

  const firstPending = wave.wilds.findIndex((w) => w.outcome === 'pending')
  const [selected, setSelected] = useState(Math.max(0, firstPending))
  const [ball, setBall] = useState<ThrowBall>(wave.studyBall === 'available' ? 'study-ball' : 'poke-ball')
  const [anim, setAnim] = useState<Anim | null>(null)
  const [counterFx, setCounterFx] = useState<{ key: number; counter: CounterResult; energyBefore: number } | null>(null)
  const [targeting, setTargeting] = useState<Charge | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // New wave → reset the selection and the default ball.
  useEffect(() => {
    setSelected(Math.max(0, wave.wilds.findIndex((w) => w.outcome === 'pending')))
    setBall(wave.studyBall === 'available' ? 'study-ball' : 'poke-ball')
    setTargeting(null)
    // The wave arrives: rustle, then one "!" per wild, a shimmer for a shiny.
    sfx('waveAppear')
    wave.wilds.forEach((_, i) => sfxLater('wildAppear', 450 + i * 160, { pan: wave.wilds.length > 1 ? -0.6 + (1.2 * i) / (wave.wilds.length - 1) : 0, volume: 0.7 }))
    if (wave.wilds.some((w) => w.isShiny)) sfxLater('shinyAppear', 500 + wave.wilds.length * 160)
  }, [enc.currentWave, enc.sessionId])

  useHintEvent('charges', enc.charges.length > 0)
  useHintEvent('shiny', wave.wilds.some((w) => w.isShiny && w.outcome === 'pending'))
  useHintEvent('ivReveal', mods.revealWildIvs)
  // The Study Ball hint quotes the current level limit.
  useEffect(() => {
    useHints.setState((h) => ({ values: { ...h.values, 'waves.studyBall': { level: studyMax } } }))
  }, [studyMax])

  const sel = wave.wilds[selected]
  const leaderUid = player.team.find((u) => (player.pokemon[u]?.energy.current ?? 0) > 0) ?? player.team[0]
  const leader = leaderUid ? pokemonView(player, leaderUid, now) : null
  const counterTarget = counterFx ? pokemonView(player, counterFx.counter.targetUid, now) : null

  const balls: { ball: ThrowBall; count: number | null; usable: boolean; reason?: string }[] = [
    ...(wave.studyBall === 'available'
      ? [{ ball: 'study-ball' as const, count: null, usable: Boolean(sel?.studyBallEligible), reason: sel && !sel.studyBallEligible ? t('waves.studyNotEligible', { level: studyMax }) : undefined }]
      : []),
    ...BALL_ORDER.map((b) => ({ ball: b as ThrowBall, count: player.inventory[b] ?? 0, usable: (player.inventory[b] ?? 0) > 0 })),
  ]
  const ballOk = balls.find((b) => b.ball === ball)?.usable ?? false
  const chance = sel && sel.outcome === 'pending' ? wildCatchChance(player, sel, ball) : 0
  const canThrow = Boolean(sel && sel.outcome === 'pending' && ballOk && !anim && !targeting)

  const onThrow = () => {
    if (!sel || !canThrow) return
    const ref = { waveIndex: enc.currentWave, wildIndex: selected }
    const before = sel
    const energyBefore = player.pokemon[leaderUid ?? '']?.energy.current ?? 0
    const r = doThrow(ref, ball)
    if (!r.ok) {
      toast.add({ title: t(`errors.throw.${r.error}`, { level: studyMax }), type: 'danger' })
      return
    }
    const outcome = r.outcome
    const resultSfx = () => sfx(outcome.kind === 'caught' ? 'catchSuccess' : 'catchFail')
    const land = () => {
      setAnim(null)
      if (outcome.kind !== 'caught' && outcome.counter) {
        const c = outcome.counter
        sfx(c.missed ? 'counterMiss' : 'counterHit')
        if (!c.missed && c.energyAfter <= 0) sfxLater('exhausted', 450)
      }
      if (outcome.kind === 'fled') sfxLater('flee', 250)
      if (outcome.kind === 'caught') {
        toast.add({ title: t('waves.caughtToast', { name: names.species(before.speciesSlug) }), description: t('waves.caughtToastBody'), type: 'success' })
        emitHintEvent('throw.caught')
      } else {
        if (outcome.counter) {
          setCounterFx({ key: Date.now(), counter: outcome.counter, energyBefore })
          emitHintEvent('throw.failed', {
            name: names.species(player.pokemon[outcome.counter.targetUid]?.speciesSlug ?? ''),
            damage: Math.round(outcome.counter.damage),
          })
        }
        if (outcome.kind === 'fled') emitHintEvent('throw.fled')
      }
      // Move the selection to the next pending wild when this one is done.
      if (outcome.kind !== 'failed') {
        const w = useGame.getState().player?.encounter?.waves[ref.waveIndex]
        const next = w ? w.wilds.findIndex((x) => x.outcome === 'pending') : -1
        if (next >= 0) setSelected(next)
      }
      if (ball === 'study-ball') setBall('poke-ball')
    }
    if (reduceMotion()) {
      resultSfx()
      land()
      return
    }
    sfx('ballThrow')
    setAnim({ ref, ball, stage: 'throw', outcome, before })
    timers.current.push(
      setTimeout(() => {
        setAnim((a) => (a ? { ...a, stage: 'wobble' } : a))
        sfx('ballShake')
      }, 550),
    )
    const wobbleMs = outcome.kind === 'caught' ? 1500 : 1000
    timers.current.push(
      setTimeout(() => {
        setAnim((a) => (a ? { ...a, stage: 'result' } : a))
        resultSfx()
      }, 550 + wobbleMs),
    )
    timers.current.push(setTimeout(land, 550 + wobbleMs + 900))
  }

  const onTarget = (i: number) => {
    if (!targeting) return
    const ref = { waveIndex: enc.currentWave, wildIndex: i }
    const err = targeting.kind === 'status' ? applyStatus(targeting.id, ref) : reroll(targeting.id, ref)
    if (err) toast.add({ title: t(`errors.charge.${err}`), type: 'danger' })
    setTargeting(null)
  }

  const isLast = enc.currentWave >= enc.waves.length - 1
  const pending = wave.wilds.filter((w) => w.outcome === 'pending').length
  useHintEvent('waveDone', pending === 0 && !anim)
  const caughtHere = wave.wilds.filter((w) => w.outcome === 'caught').length

  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl">{t('waves.title', { n: enc.currentWave + 1, total: enc.waves.length })}</h1>
          <p className="mt-1 text-mist-300">{t('waves.subtitle', { count: wave.wilds.length })}</p>
        </div>
        <div className="flex items-center gap-3">
          <StudyBallStatus status={wave.studyBall} />
          <ol className={cx('flex gap-1.5', enc.waves.length < 2 && 'hidden')} aria-label={t('waves.progress')}>
            {enc.waves.map((w) => (
              <li
                key={w.index}
                aria-current={w.index === enc.currentWave ? 'step' : undefined}
                className={cx('h-3 w-8 shadow-frame', w.index < enc.currentWave ? 'bg-mist-400' : w.index === enc.currentWave ? 'bg-volt-400' : 'bg-dusk-700')}
              >
                <span className="sr-only">{t('waves.waveN', { n: w.index + 1 })}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <Stage time={scene.time} weather={scene.weather} variant="field" className="px-4 pt-6 pb-6">
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-6">
          {wave.wilds.map((w, i) => {
            const showing = anim && anim.ref.wildIndex === i ? anim.before : w
            return (
              <li key={`${enc.currentWave}-${i}-${w.speciesSlug}`} className={wave.wilds.length >= 5 ? 'w-[11.5rem]' : 'w-52'}>
                <WildCard
                  wild={showing}
                  index={i}
                  selected={i === selected}
                  first={i === 0}
                  maxFails={mods.maxFailedThrows}
                  revealIvs={mods.revealWildIvs}
                  hitters={hittersOf(wave.hits, i)}
                  anim={anim && anim.ref.wildIndex === i ? anim : null}
                  targeting={targeting}
                  night={scene.time === 'night'}
                  studyAvailable={wave.studyBall === 'available'}
                  onSelect={() => (targeting ? onTarget(i) : setSelected(i))}
                />
              </li>
            )
          })}
        </ul>
      </Stage>

      {enc.charges.length > 0 && (
        <Panel variant="frame" title={t('waves.charges.title')} help="waves.charges" headingLevel={3} {...hintAnchor('waves.charges')}>
          <ul className="flex flex-wrap gap-3">
            {enc.charges.map((c) => (
              <li key={c.id}>
                <Button
                  variant={targeting?.id === c.id ? 'primary' : 'secondary'}
                  icon={c.kind === 'reroll' ? 'reroll' : c.status === 'sleep' ? 'sleep' : 'bolt'}
                  onClick={() => setTargeting(targeting?.id === c.id ? null : c)}
                  aria-pressed={targeting?.id === c.id}
                >
                  {c.kind === 'reroll' ? t('waves.charges.reroll') : t(`waves.charges.${c.status ?? 'sleep'}`)}
                  <span className="text-sm opacity-75">{names.move(c.source)}</span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-mist-300">{targeting ? t('waves.charges.pick') : t('waves.charges.note')}</p>
        </Panel>
      )}

      {/* Throw dock */}
      <div className="sticky bottom-4 z-20">
        <Panel padded={false} className="grid grid-cols-1 items-center gap-5 p-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]">
          <div {...hintAnchor('waves.leader')}>
            <p className="mb-1.5 flex items-center gap-2 text-sm text-mist-300">
              {t('waves.counterTarget')}
              <HelpDot hint="waves.counter" />
            </p>
            {(counterTarget ?? leader) && (
              <PokemonCard
                key={counterFx?.key}
                view={(counterTarget ?? leader)!}
                variant="compact"
                leader={(counterTarget ?? leader)!.pokemon.uid === player.team[0]}
                energyFrom={counterFx && !anim ? counterFx.energyBefore : undefined}
                shake={Boolean(counterFx && !anim)}
                floating={counterFx && !anim ? (counterFx.counter.missed ? t('waves.missed') : counterFx.counter.healed > 0 ? `+${Math.round(counterFx.counter.healed)}` : `-${Math.round(counterFx.counter.damage)}`) : undefined}
              />
            )}
            {counterFx && !anim && (
              <p className="mt-2 text-sm text-mist-300" aria-live="polite">
                {counterLine(counterFx.counter, t, names)}
              </p>
            )}
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm text-mist-300">{sel ? t('waves.pickBall', { name: names.species(sel.speciesSlug) }) : t('waves.pickWild')}</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {balls.map((b) => (
                <BallOption
                  key={b.ball}
                  ball={b.ball}
                  count={b.count}
                  checked={ball === b.ball}
                  disabled={!b.usable}
                  reason={b.reason}
                  chance={sel && sel.outcome === 'pending' && b.usable ? wildCatchChance(player, sel, b.ball) : null}
                  onPick={() => setBall(b.ball)}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            <Button {...hintAnchor('waves.throw')} data-sfx="none" size="lg" onClick={onThrow} disabled={!canThrow} beacon={canThrow && caughtHere === 0 && player.history.length <= 1}>
              <BallIcon ball={ball} size={30} />
              {t('waves.throw')}
            </Button>
            <p className="text-right text-sm text-mist-300">
              {sel && sel.outcome === 'pending' && ballOk ? t('waves.chance', { pct: fmtPct(chance, lng) }) : ' '}
            </p>
          </div>
        </Panel>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[60ch] text-sm text-mist-300">
          {pending === 0 ? t('waves.waveDone') : wave.studyBall === 'available' ? t('waves.leaveWarnStudy', { count: pending }) : t('waves.leaveWarn', { count: pending })}
        </p>
        <div className="flex gap-3" {...hintAnchor('waves.next')}>
          {!isLast && (
            <Button variant="ghost" onClick={finishWaves}>
              {t('waves.finishAll')}
            </Button>
          )}
          <Button variant={pending === 0 ? 'primary' : 'secondary'} icon="next" onClick={isLast ? finishWaves : nextWave} disabled={Boolean(anim)}>
            {isLast ? t('waves.finish') : t('waves.next', { n: enc.currentWave + 2 })}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/** Team members whose hits weakened wild `index` during the session (engine `Wave.hits`), most hits first. */
function hittersOf(hits: Wave['hits'], index: number): { uid: string; slug: string; hits: number }[] {
  if (!hits) return []
  const player = useGame.getState().player
  const by = new Map<string, number>()
  for (const h of hits) if (h.target === index) by.set(h.uid, (by.get(h.uid) ?? 0) + Math.max(1, Math.round(h.units)))
  return [...by.entries()]
    .map(([uid, n]) => ({ uid, slug: player?.pokemon[uid]?.speciesSlug ?? '', hits: n }))
    .filter((h) => h.slug)
    .sort((a, b) => b.hits - a.hits)
}

function counterLine(c: CounterResult, t: (k: string, o?: Record<string, unknown>) => string, names: ReturnType<typeof useNames>): string {
  if (c.missed) return t('waves.counterMissed')
  if (c.healed > 0) return t('waves.counterHealed', { type: names.type(c.attackType), amount: Math.round(c.healed) })
  const eff = c.effectiveness > 1 ? t('waves.effSuper') : c.effectiveness < 1 ? t('waves.effWeak') : ''
  return t('waves.counterHit', { type: names.type(c.attackType), damage: Math.round(c.damage), eff }) + (c.survivedWith1 ? ` ${t('waves.survived')}` : '')
}

function StudyBallStatus({ status }: { status: 'available' | 'used' | 'lost' | 'converted' }) {
  const { t } = useTranslation()
  return (
    <span {...hintAnchor('waves.studyBall')} className={cx('inline-flex items-center gap-2 bg-dusk-800 py-1 pr-3 pl-1.5 text-sm shadow-frame', status !== 'available' && 'text-mist-400')}>
      <StudyBallIcon size={24} className={status === 'available' ? '' : 'opacity-50 grayscale'} />
      {t(`waves.study.${status}`)}
    </span>
  )
}

function BallOption({
  ball,
  count,
  checked,
  disabled,
  reason,
  chance,
  onPick,
}: {
  ball: ThrowBall
  count: number | null
  checked: boolean
  disabled: boolean
  reason?: string
  chance: number | null
  onPick: () => void
}) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const label = ball === 'study-ball' ? t('balls.study') : names.item(ball)
  const body = (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled}
      onClick={() => !disabled && onPick()}
      className={cx(
        'flex w-full items-center gap-2 px-2.5 py-2 text-left shadow-raised transition-[translate,background-color] duration-75',
        checked ? 'translate-y-[3px] bg-volt-400 text-ink shadow-pressed' : 'bg-dusk-700 text-mist-100 hover:bg-dusk-600',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <BallIcon ball={ball} size={30} />
      <span className="min-w-0">
        <span className="block truncate font-display text-base leading-tight">{label}</span>
        <span className={cx('block text-xs', checked ? 'text-dusk-800' : 'text-mist-300')}>
          {count === null ? t('waves.studyOnlyThis') : t('waves.count', { count })}
          {chance !== null && <span className={cx('ml-2 font-num text-base leading-none', checked ? 'text-ink' : 'text-volt-300')}>{t('waves.chanceShort', { pct: fmtPct(chance, i18n.language) })}</span>}
        </span>
      </span>
    </button>
  )
  return reason ? <Tooltip content={reason}>{body}</Tooltip> : body
}

function WildCard({
  wild,
  index,
  selected,
  first,
  maxFails,
  anim,
  targeting,
  night,
  studyAvailable,
  revealIvs,
  hitters,
  onSelect,
}: {
  studyAvailable: boolean
  revealIvs: boolean
  hitters: { uid: string; slug: string; hits: number }[]
  wild: WildPokemon
  index: number
  selected: boolean
  first: boolean
  maxFails: number
  anim: Anim | null
  targeting: Charge | null
  night: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const sp = ctx.speciesBySlug.get(wild.speciesSlug)!
  const name = names.species(wild.speciesSlug)
  const done = wild.outcome !== 'pending'
  const left = Math.max(0, maxFails - wild.failedThrows)
  const result = anim?.stage === 'result' ? anim.outcome.kind : null
  const disabled = (done && !targeting) || Boolean(anim) || (targeting !== null && done)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={[
        t('waves.wildLabel', { name, level: wild.level, pct: fmtPct(wild.hpFraction, i18n.language) }),
        wild.isShiny ? t('pokemon.shiny') : '',
        wild.status ? t(`waves.status.${wild.status}`) : '',
        wild.studyBallEligible && studyAvailable ? t('waves.studyEligibleTip') : '',
        t('waves.failsLeft', { count: left }),
        done ? t(wild.outcome === 'caught' ? 'waves.caught' : 'waves.fled') : '',
      ]
        .filter(Boolean)
        .join('. ')}
      className={cx(
        'group relative flex w-full flex-col items-center text-left outline-offset-4 disabled:cursor-default',
        targeting && !done && 'cursor-crosshair',
      )}
    >
      <div className="relative flex h-40 w-full items-end justify-center">
        <Platform width={128} night={night} className="absolute bottom-0" />
        {!(anim && (anim.stage === 'wobble' || (anim.stage === 'result' && result === 'caught'))) && (
          <Sprite
            kind="showdown"
            slug={wild.speciesSlug}
            shiny={wild.isShiny}
            scale={2}
            alt=""
            className={cx(
              'relative mb-3 transition-opacity',
              wild.outcome === 'fled' && 'opacity-0',
              wild.outcome === 'caught' && 'opacity-30 grayscale',
              anim?.stage === 'result' && result !== 'caught' && 'animate-flash',
            )}
          />
        )}
        {anim && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
            <div className={cx(anim.stage === 'throw' && 'animate-throw-in', anim.stage === 'wobble' && 'origin-bottom animate-wobble', anim.stage === 'result' && result !== 'caught' && 'animate-burst')}>
              <BallIcon ball={anim.ball} size={48} />
            </div>
            {anim.stage === 'result' && result === 'caught' && (
              <span className="absolute inset-0 -m-6 animate-burst bg-[radial-gradient(circle,var(--color-volt-300)_0_30%,transparent_31%)]" aria-hidden />
            )}
          </div>
        )}
        {(wild.outcome === 'caught' || (anim?.stage === 'result' && result === 'caught')) && (
          <span className="absolute top-6 animate-stamp bg-leaf-400 px-2 py-1 font-display text-lg text-ink shadow-frame">{t('waves.caught')}</span>
        )}
        {(wild.outcome === 'fled' || (anim?.stage === 'result' && result === 'fled')) && (
          <span className="absolute top-6 animate-stamp bg-dusk-600 px-2 py-1 font-display text-lg text-mist-50 shadow-frame">{t('waves.fled')}</span>
        )}
        {wild.isShiny && !done && (
          <span className="absolute top-1 left-1 bg-shiny-300 px-1.5 py-0.5 font-display text-sm text-ink shadow-frame">★ {t('pokemon.shiny')}</span>
        )}
        {wild.studyBallEligible && studyAvailable && !done && (
          <span title={t('waves.studyEligibleTip')} className="absolute right-0 bottom-0 z-10 inline-flex items-center gap-1 bg-dusk-900/85 py-0.5 pr-1.5 pl-0.5 text-xs text-mist-50 shadow-frame">
            <StudyBallIcon size={24} />
            {t('waves.studyEligible')}
          </span>
        )}
        {wild.isLegendary && (
          <span className="absolute top-1 right-1 bg-type-psychic px-1.5 py-0.5 font-display text-sm text-ink shadow-frame">{t('waves.legendary')}</span>
        )}
      </div>

      <div
        className={cx(
          'mt-2 w-full bg-mist-50 px-3 pt-2 pb-2.5 text-ink shadow-raised transition-[translate,box-shadow]',
          selected && !done && 'outline-3 outline-volt-400 outline-offset-2',
          done && 'opacity-60',
          !disabled && 'group-hover:-translate-y-0.5',
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-display text-lg leading-tight">{name}</span>
          <span className="font-num text-xl leading-none">
            {t('pokemon.levelShort')}
            {wild.level}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {sp.types.map((ty) => (
            <TypeBadge key={ty} type={ty} />
          ))}
          {wild.status && (
            <span className="ml-auto inline-flex items-center gap-1 bg-dusk-700 px-1.5 py-0.5 text-xs text-mist-50 shadow-frame" title={t(`waves.status.${wild.status}`)}>
              <ArtIcon name={wild.status === 'sleep' ? 'icon-sleep' : 'icon-paralysis'} size={12} className="text-volt-300" />
              {t(`waves.status.${wild.status}`)}
            </span>
          )}
        </div>
        <div className="mt-2" {...(first ? hintAnchor('waves.hp') : {})}>
          <div className="flex items-center gap-2">
            <span className="w-12 font-display text-sm text-dusk-600">{t('waves.hp')}</span>
            <ProgressBar className="flex-1" size="sm" variant="hp" value={wild.hpFraction} from={1} max={1} label={t('waves.hpLabel', { name })} />
            <span className="w-10 text-right font-num text-lg leading-none">{fmtPct(wild.hpFraction, i18n.language)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs" {...(first ? hintAnchor('waves.fails') : {})}>
          <span className="w-12 font-display text-sm text-dusk-600">{t('waves.tries')}</span>
          <span className="inline-flex gap-1" role="img" aria-label={t('waves.failsLeft', { count: left })}>
            {Array.from({ length: maxFails }, (_, k) => (
              <span key={k} className={cx('size-2.5 shadow-frame', k < left ? 'bg-cheek-500' : 'bg-dusk-500/30')} />
            ))}
          </span>
        </div>
        {hitters.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-12 font-display text-sm text-dusk-600">{t('waves.hitBy')}</span>
            <span className="flex items-center gap-x-1.5" title={hitters.map((h) => `${names.species(h.slug)} ×${h.hits}`).join(', ')}>
              {hitters.slice(0, 2).map((h) => (
                <span key={h.uid} className="inline-flex items-center">
                  <Sprite kind="icon" slug={h.slug} alt={names.species(h.slug)} className="-my-2 -mx-1.5" />
                  <span className="font-num text-base leading-none">×{h.hits}</span>
                </span>
              ))}
              {hitters.length > 2 && <span className="font-num text-base leading-none text-dusk-600">+{hitters.length - 2}</span>}
            </span>
          </div>
        )}
        {revealIvs && (
          <div className="mt-2 flex items-center gap-2" {...(first ? hintAnchor('waves.iv') : {})}>
            <span className="w-12 font-display text-sm text-dusk-600">{t('iv.short')}</span>
            <IvQuality ivs={wild.ivs} tone="ink" />
          </div>
        )}
        {wild.guaranteedBall && !done && (
          <p className="mt-1.5 text-xs text-volt-700">{t('waves.shinyGuarantee', { ball: names.item(wild.guaranteedBall) })}</p>
        )}
        {targeting && !done && <p className="mt-1.5 font-display text-sm text-exp-600">{t('waves.charges.applyHere')}</p>}
      </div>
      <span className="sr-only">{index + 1}</span>
    </button>
  )
}
