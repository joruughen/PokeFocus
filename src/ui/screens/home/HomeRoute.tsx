import { usePhase } from '../../store/selectors'
import { Break } from './Break'
import { Claim } from './Claim'
import { FocusSession } from './FocusSession'
import { PreSession } from './PreSession'
import { Results } from './Results'
import { Waves } from './Waves'

/**
 * "Inicio" follows the core loop: pre-session → focus → claim → results →
 * waves → back to pre-session. The phase is derived from persisted state
 * (`phaseOf` in store/game.ts), so a reload lands on the right screen.
 */
export function HomeRoute() {
  const phase = usePhase()
  switch (phase) {
    case 'focus':
    case 'paused':
      return <FocusSession />
    case 'claim':
      return <Claim late={false} />
    case 'late':
      return <Claim late />
    case 'results':
      return <Results />
    case 'waves':
      return <Waves />
    case 'break':
      return <Break />
    default:
      return <PreSession />
  }
}
