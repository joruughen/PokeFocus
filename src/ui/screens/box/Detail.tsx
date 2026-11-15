import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pokemonView } from '../../../engine'
import { Button, Dialog, DialogClose, EmptyState, IconButton, PixelIcon, Platform, ProgressBar, RoleBadge, Sprite, Stage, toast, Tooltip, TypeBadge } from '../../components'
import { hintAnchor, useHintEvent, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { navigate } from '../../router'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useScene } from '../../store/selectors'
import { lineRoot } from '../shared/EvoLine'
import { EvolveMoment } from './EvolveMoment'
import { filteredMons, useBoxFilters } from './filters'
import { Candies, EnergyBond, Evolution } from './Growth'
import { NicknameDialog } from './Nickname'
import { roleNatureFit } from './roleNature'
import { StatsPanel } from './StatsPanel'
import { SwapDialog } from './SwapCompare'
import { Techniques } from './Techniques'
import { useContent } from '../../store/content'

/** Pokémon detail sheet (`#/box/<uid>`): everything about one individual, and what you can do with it. */
export function Detail({ uid }: { uid: string }) {
  const ctx = useContent()
  const cfg = ctx.config
  useHintScreen('detail')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const filters = useBoxFilters()
  const release = useGame((s) => s.release)
  const setTeam = useGame((s) => s.setTeam)
  const setLeader = useGame((s) => s.setLeader)
  const evolve = useGame((s) => s.evolve)
  const busy = useBusy()
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [editNick, setEditNick] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [moment, setMoment] = useState<{ from: string; to: string; shiny: boolean; nickname?: string } | null>(null)
  const minute = Math.floor(now / 60_000)
  const view = useMemo(() => pokemonView(player, uid, minute * 60_000), [player, uid, minute])
  const scene = useScene(player, now)
  const order = useMemo(() => filteredMons(player, filters, names.lng).map((p) => p.uid), [player, filters, names.lng])
  useHintEvent('evolveReady', Boolean(view?.evolutions.some((e) => !e.blockedBy)))

  if (!view) {
    return (
      <div className="bg-dusk-800 shadow-plate">
        <EmptyState title={t('detail.gone.title')} body={t('detail.gone.body')} action={<Button icon="back" onClick={() => navigate('box')}>{t('detail.back')}</Button>} />
      </div>
    )
  }

  const p = view.pokemon
  const name = names.pokemon(p)
  const speciesLabel = names.species(p.speciesSlug)
  const slot = player.team.indexOf(p.uid)
  const inTeam = slot >= 0
  const inSession = Boolean(player.activeSession?.teamUids.includes(p.uid))
  const locked = inSession ? t('detail.lockedSession', { name }) : null
  const idx = order.indexOf(uid)
  const prev = idx > 0 ? order[idx - 1] : undefined
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined
  const nature = ctx.naturesBySlug.get(p.nature)
  const fit = roleNatureFit(view.species.role, nature)
  const root = lineRoot(view.species)
  const releaseGain = cfg.progression.candiesOnRelease[view.species.stage - 1] ?? 1

  const teamAction = async () => {
    const err = await (inTeam ? setTeam(player.team.filter((u) => u !== uid)) : setTeam([...player.team, uid]))
    if (err) toast.add({ title: errorText(err, 'box'), type: 'danger' })
    else toast.add({ title: inTeam ? t('detail.removed', { name }) : t('detail.added', { name }), type: 'success' })
  }

  return (
    <div className="flex flex-col gap-8">
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t('detail.nav')}>
        <Button variant="ghost" icon="back" onClick={() => navigate('box')}>
          {t('detail.back')}
        </Button>
        {order.length > 1 && idx >= 0 && (
          <div className="flex items-center gap-2">
            <IconButton icon="back" size="sm" label={t('detail.prev')} disabled={!prev} onClick={() => prev && navigate('box', prev)} />
            <span className="font-num text-xl leading-none text-mist-300 tabular">
              {idx + 1}/{order.length}
            </span>
            <IconButton icon="next" size="sm" label={t('detail.next')} disabled={!next} onClick={() => next && navigate('box', next)} />
          </div>
        )}
      </nav>

      {/* Hero: the Pokémon on the route band + its nameplate. */}
      <Stage time={scene.time} weather={scene.weather} className="px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
          <div className="relative flex h-60 w-64 shrink-0 items-end justify-center">
            <Platform width={200} night={scene.time === 'night'} className="absolute bottom-0" />
            <Sprite kind="showdown" slug={p.speciesSlug} shiny={p.isShiny} scale={3} maxHeight={220} maxWidth={248} flip alt={name} className={cx('relative mb-5', view.energy <= 0 && 'grayscale')} />
            {p.isShiny && <span className="absolute top-2 left-2 bg-shiny-300 px-1.5 py-0.5 font-display text-sm text-ink shadow-frame">★ {t('pokemon.shiny')}</span>}
          </div>
          <div className="min-w-0 max-w-xl flex-1 bg-mist-50 p-5 text-ink shadow-plate">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl text-ink [overflow-wrap:anywhere]">{name}</h1>
                {p.nickname && <p className="text-sm text-dusk-700" aria-label={t('nick.speciesLabel', { species: speciesLabel })}>{speciesLabel}</p>}
              </div>
              <span className="font-num text-4xl leading-none">
                {t('pokemon.levelShort')}
                {p.level}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {view.types.map((ty) => (
                <TypeBadge key={ty} type={ty} size="md" />
              ))}
              {inTeam && (
                <span className={cx('inline-flex h-7 items-center gap-1 px-2 font-display text-base shadow-frame', slot === 0 ? 'bg-volt-400' : 'bg-dusk-600 text-mist-50')}>
                  <PixelIcon name={slot === 0 ? 'crown' : 'team'} size={10} />
                  {slot === 0 ? t('team.leader') : t('detail.slot', { n: slot + 1 })}
                </span>
              )}
            </div>
            {view.species.role && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <RoleBadge role={view.species.role} size="md" onLight />
                <p className="min-w-0 flex-1 basis-44 text-sm text-dusk-700">{t(`roles.${view.species.role}.body`)}</p>
              </div>
            )}
            {fit && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-ink">
                <PixelIcon name={fit.kind === 'against' ? 'down' : 'up'} size={10} className={cx('mt-[5px] shrink-0', fit.kind === 'against' ? 'text-cheek-700' : 'text-leaf-600')} />
                <span>{t(`roleInfo.${fit.kind}.${fit.role}`, { nature: names.nature(p.nature) })}</span>
              </p>
            )}
            <div className="mt-3">
              <ProgressBar
                variant="exp"
                value={view.expIntoLevel}
                max={view.expForNextLevel}
                label={t('pokemon.expOf', { name })}
                valueText={<span className="text-ink">{t('detail.expToNext', { exp: fmtInt(view.expForNextLevel - view.expIntoLevel, i18n.language) })}</span>}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2" {...hintAnchor('detail.actions')}>
              {inTeam ? (
                <>
                  {slot !== 0 && (
                    <Button size="sm" icon="crown" disabled={inSession || busy} onClick={async () => {
                      const err = await setLeader(uid)
                      if (err) toast.add({ title: errorText(err, 'box'), type: 'danger' })
                      else toast.add({ title: t('team.newLeader', { name }), type: 'success' })
                    }}>
                      {t('team.makeLeader')}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" icon="minus" disabled={inSession || busy || player.team.length <= 1} onClick={() => void teamAction()}>
                    {t('detail.removeTeam')}
                  </Button>
                </>
              ) : (
                player.team.length >= 6 ? (
                  <Tooltip content={inSession || player.activeSession ? t('detail.swapLocked') : t('detail.swapTip')}>
                    <span tabIndex={player.activeSession ? 0 : -1}>
                      <Button size="sm" icon="reroll" disabled={Boolean(player.activeSession) || busy} onClick={() => setSwapOpen(true)}>
                        {t('detail.swapTeam')}
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button size="sm" icon="plus" disabled={Boolean(player.activeSession) || busy} onClick={() => void teamAction()}>
                    {t('detail.addTeam')}
                  </Button>
                )
              )}
              <Button size="sm" variant="secondary" icon="wrench" disabled={busy} onClick={() => setEditNick(true)}>
                {p.nickname ? t('nick.change') : t('nick.add')}
              </Button>
              <Tooltip content={inTeam ? t('detail.releaseInTeam') : t('detail.releaseTip', { count: releaseGain })}>
                <span tabIndex={inTeam ? 0 : -1}>
                  {/* Danger, not ghost: the nameplate is a light card, and a ghost button there is light text on a light background. */}
                  <Button size="sm" variant="danger" icon="trash" disabled={inTeam} onClick={() => setConfirmRelease(true)}>
                    {t('detail.release')}
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
      </Stage>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <Techniques view={view} locked={locked} />
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
            <Candies view={view} locked={locked} />
            <Evolution
              view={view}
              locked={locked}
              onEvolve={async (to) => {
                if (busy) return
                const from = p.speciesSlug
                const r = await evolve(uid, to)
                if (!r.ok) {
                  toast.add({ title: errorText(r.error, 'box'), type: 'danger' })
                  return
                }
                setMoment({ from, to, shiny: p.isShiny, nickname: p.nickname })
              }}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <StatsPanel view={view} />
          <EnergyBond view={view} inSession={inSession} />
        </div>
      </div>

      <Dialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title={t('detail.releaseTitle', { name })}
        description={t('detail.releaseBody', { count: releaseGain, line: names.species(root.slug) })}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button
              variant="danger"
              icon="trash"
              disabled={busy}
              onClick={async () => {
                const err = await release(uid)
                setConfirmRelease(false)
                if (err) {
                  toast.add({ title: errorText(err, 'box'), type: 'danger' })
                  return
                }
                sfx('flee')
                toast.add({ title: t('detail.released', { name, count: releaseGain, line: names.species(root.slug) }), type: 'success' })
                navigate('box', ...(next ? [next] : prev ? [prev] : []))
              }}
            >
              {t('detail.releaseConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-4 bg-dusk-900 p-3 inset-shadow-well">
          <Sprite kind="icon" slug={p.speciesSlug} scale={2} alt="" />
          <span className="flex items-center gap-2 font-num text-3xl leading-none text-volt-300">
            <PixelIcon name="candy" size={20} />+{releaseGain}
          </span>
        </div>
      </Dialog>

      <NicknameDialog open={editNick} onOpenChange={setEditNick} mon={p} />
      {player.team.length >= 6 && !inTeam && <SwapDialog open={swapOpen} onOpenChange={setSwapOpen} incoming={view} />}

      {moment && <EvolveMoment {...moment} onClose={() => setMoment(null)} />}
    </div>
  )
}
