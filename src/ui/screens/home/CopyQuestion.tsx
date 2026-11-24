import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyCandidates, techniqueSlots } from '../../../engine'
import { Button, CopyPicker, Dialog, Platform, Sprite, toast } from '../../components'
import { useNames } from '../../lib/names'
import { useGame } from '../../store/game'
import { usePlayer } from '../../store/selectors'
import { useContent } from '../../store/content'
import { copyErrorText } from '../box/TransformPanel'
import { TransformMoment } from '../box/TransformMoment'

/**
 * The question before the results (GDD §7.3): each Ditto of the finished session that is not copying yet asks
 * whom to copy (a teammate or a random one), then its transformation plays. `onDone` runs after the last one
 * (answered or skipped).
 */
export function CopyQuestion({ uids, teamUids, onDone }: { uids: readonly string[]; teamUids: readonly string[]; onDone: () => void }) {
  const { t } = useTranslation()
  const ctx = useContent()
  const names = useNames()
  const player = usePlayer()
  const setCopy = useGame((s) => s.setCopy)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [moment, setMoment] = useState<{ to: string } | null>(null)

  const uid = uids[index]
  const p = uid ? player.pokemon[uid] : undefined
  const next = () => {
    setMoment(null)
    if (index + 1 >= uids.length) onDone()
    else setIndex(index + 1)
  }
  if (!p) {
    // The Pokémon is gone (should not happen): move on.
    queueMicrotask(next)
    return null
  }

  if (moment) return <TransformMoment from={p.speciesSlug} to={moment.to} shiny={p.isShiny} nickname={p.nickname ?? null} onClose={next} />

  const pick = async (target: string) => {
    if (busy) return
    setBusy(true)
    const r = await setCopy(p.uid, target)
    setBusy(false)
    if (!r.ok) {
      toast.add({ title: copyErrorText(r.error), type: 'danger' })
      return
    }
    const copied = r.copyOfUid ? useGame.getState().player?.pokemon[r.copyOfUid] : undefined
    if (copied) setMoment({ to: copied.speciesSlug })
    else next()
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && next()}
      size="lg"
      title={t('claim.copy.title', { name: names.pokemon(p) })}
      description={t('claim.copy.body', { count: techniqueSlots(p.level, ctx) })}
      footer={
        <Button variant="ghost" onClick={next} disabled={busy}>
          {t('claim.copy.skip')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative mx-auto flex h-32 w-48 items-end justify-center">
          <Platform width={150} className="absolute bottom-2" />
          <Sprite kind="showdown" slug={p.speciesSlug} shiny={p.isShiny} scale={2} maxHeight={96} alt={names.species(p.speciesSlug)} className="relative mb-6 motion-safe:animate-bob" />
        </div>
        <CopyPicker candidates={copyCandidates(player, p, ctx, teamUids)} slots={techniqueSlots(p.level, ctx)} onPick={(t2) => void pick(t2)} busy={busy} baseSlug={p.speciesSlug} />
      </div>
    </Dialog>
  )
}
