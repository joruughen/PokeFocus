/** Study-group panels with the scenes (server-side render): the lobby as host and as guest, and the live session. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { MINUTE_MS } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import type { GroupLook, GroupMon, StudyGroupInvite, StudyGroupMember, StudyGroupView } from '../../../game/protocol'
import { useAuth } from '../../store/auth'
import { useGame } from '../../store/game'
import { useGroups } from '../../store/group'
import { GroupSessionStatus, GroupStudyPanel } from './GroupStudy'

const NOW = Date.now()
const mon = (slug: string, shiny = false): GroupMon => ({ slug, shiny })
const SIX: GroupMon[] = [mon('pikachu', true), mon('charmander'), mon('squirtle'), mon('bulbasaur'), mon('eevee'), mon('snorlax')]
const look = (trainer: string, team: GroupMon[] = SIX): GroupLook => ({ trainer, leader: team[0] ?? null, team })
const nobody = (trainer: string): GroupLook => ({ trainer, leader: null, team: [] })

const invite = (userId: string, name: string, status: StudyGroupInvite['status'], l: GroupLook): StudyGroupInvite => ({ userId, trainerName: name, status, ...l })
const member = (userId: string, name: string, l: GroupLook, o: Partial<StudyGroupMember> = {}): StudyGroupMember => ({
  userId,
  trainerName: name,
  joinedAt: NOW - 5 * MINUTE_MS,
  endsAt: NOW + 20 * MINUTE_MS,
  leftAt: null,
  leftReason: null,
  ...l,
  ...o,
})

function group(o: Partial<StudyGroupView>): StudyGroupView {
  return {
    id: 'g1',
    hostId: 'host',
    hostName: 'Ana',
    hostLook: look('hilda'),
    minutes: 25,
    status: 'lobby',
    createdAt: NOW,
    startedAt: null,
    expiresAt: NOW + 30 * MINUTE_MS,
    members: [],
    invites: [],
    me: { host: false, invite: 'accepted', member: false },
    ...o,
  }
}

function load(current: StudyGroupView, meId: string) {
  Object.assign(useGame.getInitialState(), { player: makePlayer([makeMon('pikachu', 10, { uid: 'm' })]) })
  Object.assign(useAuth.getInitialState(), {
    status: 'authed',
    user: { id: meId, email: 'a@b.c', trainerName: 'Yo', country: 'PE', friendCode: 'ABCDEFGH', createdAt: 0, nameChangedAt: null, countryChangedAt: null, anonymousRankings: false, trainerSprite: null, role: 'player' },
  })
  Object.assign(useGroups.getInitialState(), { current, loaded: true })
}

const imgs = (html: string, dir: string) => [...html.matchAll(/<img[^>]*src="(\/sprites\/[^"]+)"/g)].map((m) => m[1]!).filter((s) => s.startsWith(`/sprites/${dir}/`))
const names = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]!)
const RAW = /\b(group|trainers|profile)\.[a-zA-Z]/

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  Object.assign(useAuth.getInitialState(), { status: 'loading', user: null })
  Object.assign(useGroups.getInitialState(), { current: null, loaded: false })
})

describe('lobby scenes', () => {
  const invites = [
    invite('me', 'Yo', 'accepted', look('lass', [mon('mew', true), mon('abra')])),
    invite('c', 'Carla', 'accepted', look('hiker')),
    invite('p', 'Pedro', 'pending', nobody('youngster')),
    invite('d', 'Dani', 'declined', nobody('beauty')),
  ]

  it('guest: I come first, then the host and the others who accepted; pending and declined are a plain list without teams', () => {
    load(group({ invites }), 'me')
    const html = renderToStaticMarkup(<GroupStudyPanel minutes={25} />)
    expect(html).not.toMatch(RAW)
    expect(names(html)).toEqual(['Yo', 'Ana', 'Carla'])
    expect(html).toContain('>You<')
    // Three characters and 2 + 6 + 6 full sprites, one of them the shiny mew; never box icons.
    expect(imgs(html, 'trainers')).toEqual(['/sprites/trainers/lass.png', '/sprites/trainers/hilda.png', '/sprites/trainers/hiker.png'])
    expect(imgs(html, 'showdown').length + imgs(html, 'showdown-shiny').length).toBe(14)
    expect(imgs(html, 'showdown-shiny')).toEqual(['/sprites/showdown-shiny/151.gif', '/sprites/showdown-shiny/25.gif', '/sprites/showdown-shiny/25.gif'])
    expect(html).not.toContain('/sprites/icons/')
    expect(html).toContain('Pedro')
    expect(html).toContain('Dani')
    expect(html).not.toContain('youngster.png')
    expect(html).not.toContain('beauty.png')
    expect(html).not.toContain('<nav') // 3 scenes: one page
  })

  it('host: my scene first (crowned), same data as everybody else, the start button', () => {
    load(group({ hostId: 'me', hostName: 'Yo', hostLook: look('red'), me: { host: true, invite: null, member: false }, invites: invites.slice(1) }), 'me')
    const html = renderToStaticMarkup(<GroupStudyPanel minutes={25} />)
    expect(names(html)).toEqual(['Yo', 'Carla'])
    expect(imgs(html, 'trainers')[0]).toBe('/sprites/trainers/red.png')
    expect(html).toContain('>You<')
    expect(html).toContain(i18n.t('group.start', { count: 1, minutes: 25 }))
  })

  it('more than four ready players: four on the first page and the arrow (mine always first)', () => {
    const more = ['a', 'b', 'c', 'd', 'e'].map((id) => invite(id, id.toUpperCase(), 'accepted', look('lass')))
    load(group({ invites: [...more, invite('me', 'Yo', 'accepted', look('red'))] }), 'me')
    const html = renderToStaticMarkup(<GroupStudyPanel minutes={25} />)
    expect(names(html)).toEqual(['Yo', 'Ana', 'A', 'B'])
    expect(html).toContain('1/2')
    expect(html).toContain('Next players (page 2 of 2)')
  })
})

describe('session scenes', () => {
  it('shows every member as a scene, mine first; whoever left or finished is dimmed', async () => {
    const g = group({
      status: 'started',
      startedAt: NOW - 5 * MINUTE_MS,
      me: { host: false, invite: 'joined', member: true },
      members: [
        member('host', 'Ana', look('hilda')),
        member('me', 'Yo', look('lass')),
        member('l', 'Luis', look('hiker'), { leftAt: NOW - MINUTE_MS, leftReason: 'pause' }),
        member('d', 'Dani', look('beauty'), { leftAt: NOW - 2 * MINUTE_MS, leftReason: 'finished', endsAt: NOW - MINUTE_MS }),
      ],
    })
    load(g, 'me')
    const html = renderToStaticMarkup(<GroupSessionStatus />)
    expect(html).not.toMatch(RAW)
    expect(names(html)).toEqual(['Yo', 'Ana', 'Luis', 'Dani'])
    expect(html.match(/opacity-60 saturate-50/g)).toHaveLength(2)
    expect(html).toContain('studying')
    expect(html).toContain('finished')
    expect(html).toContain('out · ')
    expect(html).toContain('line-through')
    expect(imgs(html, 'trainers')).toHaveLength(4)
    expect(imgs(html, 'icons')).toEqual([])
    await i18n.changeLanguage('es')
    const es = renderToStaticMarkup(<GroupSessionStatus />)
    expect(es).not.toMatch(RAW)
    expect(es).toContain('>Tú<')
    expect(es).toContain('estudiando')
  })
})
