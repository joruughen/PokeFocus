import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TradeArrival } from '../../engine'
import { whatsNewDue } from '../changelog/WhatsNewDialog'
import { Button, Dialog, Mascot, Platform, Sprite, toast } from '../components'
import { setHintsHeld, useHints } from '../hints'
import { LEVEL_UP_CALM_PHASES } from '../levelUp/levelUp'
import { errorText } from '../lib/errors'
import { useNames } from '../lib/names'
import { sfx } from '../lib/sound'
import { EvolveMoment } from '../screens/box/EvolveMoment'
import { phaseOf, useGame } from '../store/game'
import { SHOWCASE_GAMMA } from '../lib/spriteSize'

/**
 * The server's `game` event (SSE) already brings the arrival in at once, so this is only a short pause (the
 * confirm dialog that triggered it is closing) and a quick re-check while another window is up. It was 1.8 s + 1 s
 * retries (≈2.5 s felt slow); both are in-memory checks, no extra server load.
 */
export const ARRIVAL_SETTLE_MS = 450
export const ARRIVAL_RETRY_MS = 350

/** Arrivals already shown on this device (the server empties `pendingTrades` on `ackTrade`; until then they must not reopen). */
const dismissed = new Set<string>()
const keyOf = (a: TradeArrival) => `${a.at}:${a.uid}`

const anotherDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

function owed(): TradeArrival[] {
  return (useGame.getState().player?.pendingTrades ?? []).filter((a) => !dismissed.has(keyOf(a)))
}

/**
 * A Pokémon arrived by trade (GDD §12.8): at a calm moment (same rule as the trainer level-up window:
 * never in a session, waves or a break, over a hint or another dialog), show who arrived and from whom;
 * a trade evolution (Kadabra, Machoke, Graveler, Haunter) plays the evolution moment first. Closing the
 * last one sends `ackTrade`. Mount once in the app shell.
 */
export function TradeArrivalHost() {
  const list = useGame((s) => s.player?.pendingTrades)
  const ack = useGame((s) => s.ackTrade)
  const hintOpen = useHints((s) => s.active !== null)
  const [queue, setQueue] = useState<TradeArrival[] | null>(null)
  const [evolving, setEvolving] = useState(true)
  const idle = queue === null
  const any = (list?.length ?? 0) > 0

  useEffect(() => {
    if (!idle || !any) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const pending = owed()
      const { player, timer: tm, outcome, breakTimer } = useGame.getState()
      const phase = phaseOf({ player, timer: tm, outcome, breakTimer }, Date.now())
      // Same calm moments as the trainer level-up window, which goes first.
      const levelUpOwed = (player?.pendingLevelUps?.length ?? 0) > 0
      if (pending.length === 0) return
      const calm = LEVEL_UP_CALM_PHASES.includes(phase) && useHints.getState().active === null && !anotherDialogOpen() && !levelUpOwed && !whatsNewDue()
      if (calm) {
        setEvolving(true)
        setQueue(pending)
      } else timer = setTimeout(attempt, ARRIVAL_RETRY_MS)
    }
    timer = setTimeout(attempt, ARRIVAL_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [idle, any, list, hintOpen])

  useEffect(() => {
    if (idle) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [idle])

  const current = queue?.[0]
  if (!queue || !current) return null
  const next = () => {
    dismissed.add(keyOf(current))
    const rest = queue.slice(1)
    if (rest.length > 0) {
      setEvolving(true)
      setQueue(rest)
      return
    }
    setQueue(null)
    void ack().then((err) => {
      if (err) toast.add({ title: errorText(err), type: 'danger' })
    })
  }
  if (current.fromSpecies !== current.toSpecies && evolving) {
    return <EvolveMoment key={keyOf(current)} from={current.fromSpecies} to={current.toSpecies} shiny={current.shiny} onClose={() => setEvolving(false)} />
  }
  return <TradeArrivalModal key={keyOf(current)} arrival={current} onClose={next} />
}

/** The "it arrived" window (controlled, open): the Pokémon pops in on a night stage with a burst, Profe Pika cheers. Exported for tests. */
export function TradeArrivalModal({ arrival, onClose }: { arrival: TradeArrival; onClose: () => void }) {
  const { t } = useTranslation()
  const names = useNames()
  useEffect(() => {
    sfx('evolveDone')
  }, [])
  const evolved = arrival.fromSpecies !== arrival.toSpecies
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('trades.arrival.title', { name: names.species(arrival.toSpecies) })}
      description={evolved ? t('trades.arrival.evolved', { from: names.species(arrival.fromSpecies), to: names.species(arrival.toSpecies), name: arrival.partnerName }) : t('trades.arrival.body', { name: arrival.partnerName })}
      footer={
        <Button icon="check" onClick={onClose}>
          {t('trades.arrival.ok')}
        </Button>
      }
    >
      <TradeArrivalBody arrival={arrival} />
    </Dialog>
  )
}

/** The stage of the arrival window (server-renderable). */
export function TradeArrivalBody({ arrival }: { arrival: TradeArrival }) {
  const { t } = useTranslation()
  const names = useNames()
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-48 items-end justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-dusk-700),var(--color-dusk-950)_70%)] shadow-plate">
        <span className="absolute inset-0 m-auto size-48 motion-safe:animate-burst bg-[radial-gradient(circle,var(--color-volt-200)_0_30%,transparent_31%)]" aria-hidden />
        <Platform width={170} night className="absolute bottom-4" />
        <Sprite kind="showdown" slug={arrival.toSpecies} shiny={arrival.shiny} box={{ height: 130, width: 200, gamma: SHOWCASE_GAMMA }} alt={names.species(arrival.toSpecies)} className="relative mb-8 motion-safe:animate-pop-in" />
        <Mascot pose="cheer" size={48} className="absolute right-2 bottom-1" />
      </div>
      <p className="text-sm text-mist-300">{t('trades.arrival.note')}</p>
    </div>
  )
}
