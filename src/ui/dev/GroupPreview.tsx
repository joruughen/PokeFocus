/**
 * Development-only preview of the study-group scenes (NOT in the production build: src/main.tsx only loads it
 * under `import.meta.env.DEV`). It needs no account or server, so a headless browser can take screenshots of it:
 *
 *   /?groupPreview                       session view, page 1 (six players)
 *   /?groupPreview&page=2                the second page
 *   &view=lobby | session | picker       the lobby panel, the in-session panel, the profile character picker
 *   &lng=en | es   &time=day | evening | night   &players=1..8   &wait=1 (a pending invitee under the lobby)
 *   picker: &chosen=<slug> (the saved character)  &open=1 (chooser dialog open)  &group=all|featured|classic|older|fan
 *           &sub=gen3|<author>  &q=<search text>  &pending=<slug> (the character being previewed)
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PixelIcon } from '../components'
import type { TimeOfDay } from '../lib/conditions'
import { isTrainerSprite, type TrainerGroup } from '../../game/trainerCatalog'
import type { GroupMon } from '../../game/protocol'
import { TrainerPicker } from '../screens/profile/TrainerPicker'
import { GroupRoster, meFirst, type SceneState, type ScenePlayer } from '../screens/home/GroupScenes'
import { makeMon, makePlayer } from '../../engine/test-helpers'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'

const m = (slug: string, shiny = false): GroupMon => ({ slug, shiny })

interface Mock {
  name: string
  trainer: string
  team: GroupMon[]
  state: SceneState
  host?: boolean
  you?: boolean
  /** Why they are out / finished (shown as the state). */
  why?: string
}

const MOCKS: Mock[] = [
  { name: 'Ana', trainer: 'hilda', host: true, state: 'in', team: [m('eevee'), m('vaporeon'), m('jolteon'), m('flareon'), m('porygon'), m('dragonite')] },
  { name: 'Jorge', trainer: 'acetrainer', you: true, state: 'in', team: [m('pikachu', true), m('charizard'), m('blastoise'), m('venusaur'), m('snorlax'), m('gengar')] },
  { name: 'Luis', trainer: 'scientist', state: 'in', team: [m('mewtwo'), m('mew'), m('alakazam'), m('machamp')] },
  { name: 'Carla', trainer: 'lass', state: 'in', team: [m('gyarados'), m('lapras'), m('magikarp'), m('psyduck'), m('onix'), m('moltres')] },
  { name: 'Beto', trainer: 'hiker', state: 'left', why: 'pause', team: [m('arcanine'), m('ninetales'), m('nidoking'), m('rapidash'), m('golem'), m('exeggutor')] },
  { name: 'Dani', trainer: 'psychicf', state: 'done', team: [m('articuno'), m('zapdos'), m('moltres', true), m('dragonite'), m('gengar')] },
  { name: 'Eli', trainer: 'bugcatcher', state: 'in', team: [m('pikachu'), m('eevee')] },
  { name: 'Fran', trainer: 'blackbelt', state: 'in', team: [m('machamp'), m('golem'), m('onix'), m('snorlax'), m('gyarados'), m('lapras')] },
]

function param(name: string): string | null {
  return new URLSearchParams(location.search).get(name)
}

export default function GroupPreview() {
  const { t, i18n } = useTranslation()
  const view = param('view') ?? 'session'
  const time = (['morning', 'day', 'evening', 'night'].includes(param('time') ?? '') ? param('time') : 'day') as TimeOfDay
  const page = Math.max(0, (Number(param('page')) || 1) - 1)
  const count = Math.min(8, Math.max(1, Number(param('players')) || 6))
  const lng = param('lng')
  useEffect(() => {
    if (lng === 'en' || lng === 'es') void i18n.changeLanguage(lng)
  }, [lng, i18n])
  // The picker reads the signed-in account and your leader: give it fake ones.
  useEffect(() => {
    useGame.setState({ player: makePlayer([makeMon('pikachu', 10, { uid: 'm' })]) })
    useAuth.setState({
      status: 'authed',
      user: { id: 'preview-user', email: 'x@example.com', trainerName: 'Jorge', country: 'PE', friendCode: 'ABCD2345', createdAt: 0, nameChangedAt: null, countryChangedAt: null, anonymousRankings: false, trainerSprite: isTrainerSprite(param('chosen')) ? param('chosen') : null, role: 'player' },
    })
  }, [])

  const players: ScenePlayer[] = meFirst(
    MOCKS.slice(0, count).map((p, i) => ({
      userId: `u${i}`,
      name: p.name,
      trainer: p.trainer,
      team: p.team,
      you: Boolean(p.you),
      host: Boolean(p.host),
      state: view === 'lobby' ? 'ready' : p.state,
      stateText:
        view === 'lobby'
          ? p.host
            ? t('group.host')
            : t('group.inviteStatus.accepted')
          : p.state === 'in'
            ? t('group.session.studying')
            : p.state === 'done'
              ? t('group.session.done')
              : t('group.session.leftBecause', { reason: t(`group.reason.${p.why ?? 'pause'}`) }),
    })),
    // `meFirst` matches by id: "you" is Jorge.
    `u${MOCKS.findIndex((p) => p.you)}`,
  )

  return (
    <main className="mx-auto min-h-screen max-w-[76rem] bg-dusk-950 p-4 sm:p-8" id="main">
      {view === 'picker' ? (
        <TrainerPicker
          initialOpen={Boolean(param('open'))}
          chooser={{
            initialGroup: (param('group') ?? undefined) as TrainerGroup | 'all' | undefined,
            initialSub: param('sub') ?? undefined,
            initialQuery: param('q') ?? undefined,
            initialPending: isTrainerSprite(param('pending')) ? param('pending')! : undefined,
          }}
        />
      ) : view === 'lobby' ? (
        // The lobby sits in the right column of the home screen (PreSession).
        <div className="xl:ml-auto xl:w-[40%]">
          <Panel title={t('group.title')}>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-mist-300">{t('group.lobbyHost', { minutes: 25 })}</p>
              <GroupRoster players={players} time={time} label={t('group.scene.roster')} initialPage={page} />
              {param('wait') && (
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center gap-2 text-sm">
                    <PixelIcon name="clock" size={16} className="text-mist-400" />
                    <span className="flex-1 truncate">Gus</span>
                    <span className="text-xs text-mist-400">{t('group.inviteStatus.pending')}</span>
                  </li>
                </ul>
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <Panel variant="frame" title={t('group.session.title')} headingLevel={2} className="mx-auto w-full max-w-5xl">
          <GroupRoster players={players} time={time} label={t('group.session.members')} initialPage={page} />
        </Panel>
      )}
    </main>
  )
}
