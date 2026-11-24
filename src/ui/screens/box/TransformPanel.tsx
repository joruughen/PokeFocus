import i18n from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyCandidates, masteryMultiplier, masteryStars, type PokemonView } from '../../../engine'
import { Button, CopyPicker, Dialog, DialogClose, Panel, PixelIcon, Sprite, Stars, toast, Tooltip, TypeBadge } from '../../components'
import { errorText } from '../../lib/errors'
import { fmtHours, fmtNum } from '../../lib/format'
import { useNames } from '../../lib/names'
import { useContent } from '../../store/content'
import { useGame } from '../../store/game'
import { useBusy, usePlayer } from '../../store/selectors'
import { TransformMoment } from './TransformMoment'

/** Error text of a refused copy: the transform family first, then the generic box ones. */
export function copyErrorText(code: string): string {
  const key = `transform.errors.${code}`
  return i18n.exists(key) ? i18n.t(key) : errorText(code, 'box')
}

/**
 * "Transformación" section of the sheet (only for Pokémon that can copy, i.e. Ditto): what it
 * looks like now, the techniques it borrows (read-only) and the buttons to copy / change / stop.
 * Free and unlimited between sessions; blocked while it is in the running session.
 */
export function TransformPanel({ view }: { view: PokemonView }) {
  const ctx = useContent()
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const busy = useBusy()
  const setCopy = useGame((s) => s.setCopy)
  const [open, setOpen] = useState(false)
  const [moment, setMoment] = useState<{ from: string; to: string } | null>(null)
  const p = view.pokemon
  const copy = view.copy
  const copied = copy ? player.pokemon[copy.uid] : undefined
  const copiedName = copied ? names.pokemon(copied) : copy ? names.species(copy.speciesSlug) : ''
  const candidates = copyCandidates(player, p, ctx)
  const inSession = Boolean(player.activeSession?.teamUids.includes(p.uid))
  const blocked = inSession ? t('transform.panel.lockedSession') : candidates.length === 0 ? t('transform.panel.noCandidates') : null
  const lookSlug = copy?.speciesSlug ?? p.speciesSlug

  const pick = async (target: string | 'random' | null) => {
    if (busy) return
    const from = lookSlug
    const r = await setCopy(p.uid, target)
    setOpen(false)
    if (!r.ok) {
      toast.add({ title: copyErrorText(r.error), type: 'danger' })
      return
    }
    const to = r.copyOfUid ? (player.pokemon[r.copyOfUid]?.speciesSlug ?? p.speciesSlug) : p.speciesSlug
    if (to !== from) setMoment({ from, to })
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {t('transform.panel.title')}
          <Tooltip
            variant="help"
            side="bottom"
            content={
              <span className="flex max-w-[34ch] flex-col gap-1.5 text-left">
                <span className="font-display text-base">{t('transform.panel.helpTitle')}</span>
                <span>{t('transform.panel.help.types')}</span>
                <span>{t('transform.panel.help.techniques', { count: view.slots })}</span>
                <span>{t('transform.panel.help.mastery')}</span>
                <span>{t('transform.panel.help.keeps')}</span>
                <span>{t('transform.panel.help.reverts')}</span>
              </span>
            }
          >
            <button type="button" aria-label={t('transform.panel.helpTitle')} className="inline-grid size-6 shrink-0 place-items-center bg-dusk-600 text-volt-300 shadow-frame transition-colors hover:bg-volt-400 hover:text-ink">
              <PixelIcon name="help" size={16} />
            </button>
          </Tooltip>
        </span>
      }
    >

      <div className="flex flex-wrap items-center gap-4 bg-dusk-900 p-3 inset-shadow-well">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden bg-dusk-700">
          <Sprite kind="icon" slug={lookSlug} shiny={p.isShiny} scale={2} maxHeight={72} maxWidth={72} alt="" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="font-display text-xl leading-tight text-mist-50 [overflow-wrap:anywhere]">
            {copy ? t('transform.panel.copying', { name: copiedName }) : t('transform.panel.isBase', { name: names.species(p.speciesSlug) })}
          </p>
          {copy && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-mist-300">{t('transform.panel.types')}</span>
              {view.fightTypes.map((ty) => (
                <TypeBadge key={ty} type={ty} />
              ))}
            </div>
          )}
        </div>
      </div>

      {copy && (
        <div className="mt-4">
          <h3 className="mb-2 text-lg">{t('transform.panel.copiedFrom', { name: copiedName })}</h3>
          {copy.techniques.length === 0 ? (
            <p className="text-sm text-mist-300">{t('transform.panel.noTechniques', { name: copiedName })}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {copy.techniques.map((m) => (
                <li key={m.slug} className="min-w-0 bg-dusk-900 p-3 inset-shadow-well">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-display text-lg leading-tight text-mist-50">{names.move(m.slug)}</span>
                    <TypeBadge type={m.type} />
                  </div>
                  {copied && <CopiedMastery minutes={copied.moveMasteryMinutes[m.slug] ?? 0} name={copiedName} />}
                  <p className="mt-1 text-sm leading-snug text-mist-300">
                    {m.kind === 'damage' ? t('tech.damageDesc', { type: names.type(m.type), power: m.power }) : names.technique(m.slug)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {blocked && (
        <p className="mt-4 flex items-center gap-2 bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well" role="note">
          <PixelIcon name={inSession ? 'lock' : 'team'} size={20} className="shrink-0" />
          {blocked}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button icon="reroll" disabled={busy || blocked !== null} onClick={() => setOpen(true)}>
          {copy ? t('transform.panel.change') : t('transform.panel.transform')}
        </Button>
        {copy && (
          <Button variant="secondary" icon="back" disabled={busy || inSession} onClick={() => void pick(null)}>
            {t('transform.pick.stop', { name: names.species(p.speciesSlug) })}
          </Button>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={t('transform.pick.title')}
        description={t('transform.pick.body', { count: view.slots })}
        footer={<DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />}
      >
        <CopyPicker
          candidates={candidates}
          slots={view.slots}
          currentUid={copy?.uid ?? null}
          busy={busy}
          baseSlug={p.speciesSlug}
          onPick={(target) => void pick(target)}
          onStop={copy ? () => void pick(null) : undefined}
        />
      </Dialog>

      {moment && <TransformMoment {...moment} shiny={p.isShiny} nickname={p.nickname} base={p.speciesSlug} onClose={() => setMoment(null)} />}
    </Panel>
  )
}

/** Mastery stars of a copied technique: the teammate's, with the same bubble as on its own techniques. */
function CopiedMastery({ minutes, name }: { minutes: number; name: string }) {
  const { t } = useTranslation()
  const cfg = useContent().config
  const stars = masteryStars(minutes, cfg)
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-mist-300">
      <Tooltip
        variant="help"
        content={
          <span className="flex flex-col gap-1">
            <span className="font-display text-base">{t('tech.masteryTitle', { stars })}</span>
            <span>{t('tech.masteryBody', { hours: fmtHours(minutes), mult: fmtNum(masteryMultiplier(minutes, cfg)) })}</span>
          </span>
        }
      >
        <button type="button" className="inline-flex shrink-0 items-center" aria-label={t('tech.masteryAria', { stars })}>
          <Stars value={stars} max={5} label="" />
        </button>
      </Tooltip>
      <span>{t('transform.panel.mastery', { name })}</span>
    </div>
  )
}
