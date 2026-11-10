import { useTranslation } from 'react-i18next'
import { defaultContext, levelCapFor } from '../../../engine'
import { HelpDot, Panel, PixelIcon, Platform, RoleBadge, Segmented, Sprite, TypeBadge } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { pick, useNames } from '../../lib/names'
import { navigate, useRouteParams } from '../../router'
import { usePlayer } from '../../store/selectors'
import { EvoLine } from '../shared/EvoLine'
import { useMemo, useState } from 'react'
import { useContent } from '../../store/content'

type Show = 'all' | 'caught' | 'missing'

/** Pokédex: the 56 species of the pack as seen / caught / unknown, and the level-cap ladder. */
export default function Dex() {
  const ctx = useContent()
  const ALL = useMemo(() => [...ctx.data.species].sort((a, b) => a.id - b.id), [ctx])
  const CAPS = ctx.config.progression.levelCaps
  useHintScreen('dex')
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const [param] = useRouteParams()
  const [show, setShow] = useState<Show>('all')
  const caught = new Set(player.pokedex.caught)
  const seen = new Set(player.pokedex.seen)
  const known = (slug: string) => (caught.has(slug) ? 'caught' : seen.has(slug) ? 'seen' : 'unknown') as 'caught' | 'seen' | 'unknown'
  const selected = ALL.find((s) => s.slug === param) ?? ALL.find((s) => caught.has(s.slug)) ?? ALL[0]!
  const list = ALL.filter((s) => (show === 'caught' ? caught.has(s.slug) : show === 'missing' ? !caught.has(s.slug) : true))
  const nCaught = player.pokedex.caught.length
  const cap = levelCapFor(nCaught)
  const next = CAPS.find((c) => c.species > nCaught)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            {t('nav.dex')}
            <HelpDot hint="dex.intro" />
          </h1>
          <p className="mt-1 text-mist-300">{t('dex.counts', { caught: nCaught, seen: player.pokedex.seen.length, total: ALL.length })}</p>
        </div>
      </header>

      {/* Level-cap ladder: species caught → max level of your Pokémon. */}
      <Panel title={t('dex.capTitle')} help="dex.cap" {...hintAnchor('dex.cap')}>
        <div className="relative mx-2 mt-8 mb-12 h-3 bg-ink shadow-frame">
          <div className="absolute inset-y-0 left-0 bg-volt-400" style={{ width: `${Math.min(1, nCaught / ALL.length) * 100}%` }}>
            <div className="h-1 bg-white/35" />
          </div>
          {CAPS.map((c) => {
            const reached = nCaught >= c.species
            return (
              <div key={c.cap} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${(c.species / ALL.length) * 100}%` }}>
                <span className={cx('block size-5 rotate-45 shadow-frame', reached ? 'bg-volt-400' : 'bg-dusk-600')} aria-hidden />
                <span className={cx('absolute -top-8 font-num text-2xl leading-none whitespace-nowrap', c.species === 0 ? '-left-1' : 'left-1/2 -translate-x-1/2', reached ? 'text-volt-300' : 'text-mist-300')}>
                  {t('pokemon.levelShort')} {c.cap}
                </span>
                <span className={cx('absolute top-6 text-xs whitespace-nowrap text-mist-400', c.species === 0 ? '-left-1' : 'left-1/2 -translate-x-1/2')}>{c.species === 0 ? t('dex.capStart') : t('dex.capAt', { count: c.species })}</span>
              </div>
            )
          })}
        </div>
        <p className="text-mist-100">
          {next ? t('dex.capNext', { cap, need: next.species - nCaught, next: next.cap }) : t('dex.capTop', { cap })}
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex min-w-0 flex-col gap-4" aria-label={t('dex.gridLabel')}>
          <Segmented<Show>
            label={t('dex.show')}
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: t('dex.showAll') },
              { value: 'caught', label: t('dex.showCaught') },
              { value: 'missing', label: t('dex.showMissing') },
            ]}
          />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2" {...hintAnchor('dex.grid')}>
            {list.map((s) => {
              const k = known(s.slug)
              const legendary = s.isLegendary || s.isMythical
              return (
                <li key={s.slug}>
                  <button
                    type="button"
                    onClick={() => navigate('dex', s.slug)}
                    aria-current={s.slug === selected.slug ? 'true' : undefined}
                    aria-label={`#${String(s.id).padStart(3, '0')} ${k === 'unknown' ? t('dex.unknownName') : names.species(s.slug)}, ${t(`dex.state.${k}`)}`}
                    className={cx(
                      'flex w-full flex-col items-center gap-0.5 bg-dusk-800 px-1 pt-1.5 pb-2 shadow-frame transition-colors hover:bg-dusk-700',
                      s.slug === selected.slug && 'bg-dusk-700 outline-3 outline-offset-2 outline-volt-400',
                      k === 'unknown' && 'bg-dusk-900',
                    )}
                  >
                    <span className="self-start pl-1 font-num text-base leading-none text-mist-400">#{String(s.id).padStart(3, '0')}</span>
                    <span className="grid h-12 place-items-center">
                      <Sprite kind="icon" slug={s.slug} scale={2} alt="" className={cx(k === 'unknown' && 'brightness-0 opacity-50', k === 'seen' && 'opacity-60 grayscale-[.6]')} />
                    </span>
                    <span className={cx('w-full truncate px-1 text-center text-xs', k === 'unknown' ? 'text-mist-400' : 'text-mist-100')}>
                      {k === 'unknown' ? t('dex.unknownName') : names.species(s.slug)}
                    </span>
                    <span className="flex h-3 items-center gap-1" aria-hidden>
                      {k === 'caught' && <PixelIcon name="check" size={10} className="text-leaf-400" />}
                      {legendary && <PixelIcon name="star" size={10} className="text-type-psychic" />}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <DexEntry slug={selected.slug} state={known(selected.slug)} owned={Object.values(player.pokemon).filter((p) => p.speciesSlug === selected.slug).length} known={known} />
      </div>
    </div>
  )
}

function DexEntry({ slug, state, owned, known }: { slug: string; state: 'caught' | 'seen' | 'unknown'; owned: number; known: (s: string) => 'caught' | 'seen' | 'unknown' }) {
  const ctx = defaultContext()
  const { t } = useTranslation()
  const names = useNames()
  const sp = ctx.speciesBySlug.get(slug)!
  const hidden = state === 'unknown'
  return (
    <aside className="xl:sticky xl:top-6 xl:self-start" aria-live="polite">
      <Panel padded={false} className="overflow-hidden">
        <div className="relative flex h-44 items-end justify-center bg-[linear-gradient(to_bottom,var(--color-dusk-700),var(--color-dusk-900))]">
          <Platform width={150} night className="absolute bottom-4" />
          <Sprite kind="showdown" slug={slug} scale={2} alt={hidden ? t('dex.unknownName') : names.species(slug)} className={cx('relative mb-7', hidden && 'brightness-0 opacity-60', state === 'seen' && 'grayscale-[.6]')} />
          <span className="absolute top-3 left-4 font-num text-2xl leading-none text-mist-400">#{String(sp.id).padStart(3, '0')}</span>
          {(sp.isLegendary || sp.isMythical) && !hidden && <span className="absolute top-3 right-4 bg-type-psychic px-1.5 py-0.5 font-display text-sm text-ink shadow-frame">{t(sp.isMythical ? 'dex.mythical' : 'dex.legendary')}</span>}
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-2xl">{hidden ? t('dex.unknownName') : names.species(slug)}</h2>
            {!hidden && <p className="text-sm text-mist-300">{pick(sp.genus, names.lng)}</p>}
          </div>
          {hidden ? (
            <p className="text-mist-300">{t('dex.unknownBody')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {sp.types.map((ty) => (
                  <TypeBadge key={ty} type={ty} size="md" />
                ))}
              </div>
              <p className="leading-relaxed text-mist-100">{pick(sp.flavorText, names.lng)}</p>
              <p className={cx('flex items-center gap-2 text-sm', state === 'caught' ? 'text-leaf-400' : 'text-mist-300')}>
                <PixelIcon name={state === 'caught' ? 'check' : 'search'} size={10} />
                {state === 'caught' ? (owned > 0 ? t('dex.owned', { count: owned }) : t('dex.caughtNone')) : t('dex.seenOnly')}
              </p>
              {sp.role && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <RoleBadge role={sp.role} size="md" />
                  <p className="min-w-0 flex-1 basis-44 text-sm text-mist-300">{t(`roles.${sp.role}.body`)}</p>
                </div>
              )}
            </>
          )}
          <div>
            <h3 className="mb-2 text-lg">{t('dex.line')}</h3>
            <EvoLine slug={slug} known={known} onPick={(s) => navigate('dex', s)} />
          </div>
        </div>
      </Panel>
    </aside>
  )
}
