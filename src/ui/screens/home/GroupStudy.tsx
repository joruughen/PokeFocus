/**
 * Study groups UI (docs/session-depth-plan.md §C):
 * - `GroupStudyPanel` (PreSession): "Estudiar con amigos" — invite, lobby, start.
 * - `GroupSessionStatus` (FocusSession): who is still in, accompanied time, Fairy estimate.
 * - `GroupFairyNote` (Results): the final Fairy bonus and why.
 * The server computes the real bonus at claim; everything here is display.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { conditionTypes, MINUTE_MS, toLocal, type SessionResult } from '../../../engine'
import { fairyMultiplier, groupOverlap } from '../../../game/group'
import type { StudyGroupMember, StudyGroupView } from '../../../game/protocol'
import { Button, Panel, PixelIcon, toast, TypeBadge } from '../../components'
import { timeOfDay } from '../../lib/conditions'
import { cx } from '../../lib/cx'
import { fmtNum, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { hrefTo } from '../../router'
import { useAuth } from '../../store/auth'
import { useNow } from '../../store/clock'
import { groupErrorText, useGroups } from '../../store/group'
import { useFriends } from '../../store/social'
import { usePlayer } from '../../store/selectors'
import { useContent } from '../../store/content'
import { GroupRoster, meFirst, type SceneState, type ScenePlayer } from './GroupScenes'

const fail = (code: string | null) => {
  if (code) toast.add({ title: groupErrorText(code), type: 'danger' })
  return code === null
}

/** Does the current team have a Fairy-type member (incl. Tera)? */
function useTeamHasFairy(at: number): boolean {
  const ctx = useContent()
  const player = usePlayer()
  return player.team.some((uid) => {
    const p = player.pokemon[uid]
    return p ? conditionTypes(p, at, ctx).includes('fairy') : false
  })
}

// ---------------------------------------------------------------------------
// PreSession: invite / lobby
// ---------------------------------------------------------------------------

export function GroupStudyPanel({ minutes }: { minutes: number }) {
  const { t } = useTranslation()
  const current = useGroups((s) => s.current)
  const loaded = useGroups((s) => s.loaded)
  const load = useGroups((s) => s.load)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  const lobby = current && current.status === 'lobby' ? current : null
  return (
    <Panel title={t('group.title')} aria-live="polite">
      {lobby ? lobby.me.host ? <HostLobby group={lobby} /> : <GuestLobby group={lobby} /> : <CreateGroup minutes={minutes} />}
    </Panel>
  )
}

function CreateGroup({ minutes }: { minutes: number }) {
  const cond = useContent().config.conditions
  const fairyPct = Math.round((cond.fairy - 1) * 100)
  const teamPct = Math.round(cond.groupTeamBonus * 100)
  const dustPct = Math.round(cond.groupDustBonus * 100)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const create = useGroups((s) => s.create)
  const busy = useGroups((s) => s.busy)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const hasFairy = useTeamHasFairy(useNow())
  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-mist-300">{t('group.intro', { pct: fairyPct, teamPct, dustPct })}</p>
        {!hasFairy && <p className="text-xs text-mist-400">{t('group.noFairyHint')}</p>}
        <div>
          <Button variant="secondary" icon="friends" onClick={() => setOpen(true)}>
            {t('group.studyWithFriends')}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist-300">{t('group.pickFriends', { minutes })}</p>
      <FriendPicker picked={picked} onChange={setPicked} />
      <div className="flex flex-wrap gap-3">
        <Button
          icon="friends"
          disabled={busy || picked.size === 0}
          aria-busy={busy}
          onClick={async () => {
            if (fail(await create(minutes, [...picked]))) {
              setPicked(new Set())
              setOpen(false)
            }
          }}
        >
          {t('group.sendInvites', { count: picked.size, minutes })}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
      <p className="text-xs text-mist-400">{t('group.rules')}</p>
    </div>
  )
}

/** Checkbox list of accepted friends (minus `exclude`). */
function FriendPicker({ picked, onChange, exclude = [] }: { picked: Set<string>; onChange: (s: Set<string>) => void; exclude?: string[] }) {
  const { t } = useTranslation()
  const friends = useFriends((s) => s.friends)
  const loadFriends = useFriends((s) => s.load)
  useEffect(() => {
    if (friends === null) void loadFriends()
  }, [friends, loadFriends])
  const list = (friends ?? []).filter((f) => f.status === 'friend' && !exclude.includes(f.userId))
  if (friends === null) return <p className="text-sm text-mist-400">{t('common.loading')}</p>
  if (list.length === 0) {
    return (
      <p className="text-sm text-mist-300">
        {t('group.noFriends')}{' '}
        <a href={hrefTo('friends')} className="text-volt-300 underline">
          {t('group.goFriends')}
        </a>
      </p>
    )
  }
  return (
    <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto bg-dusk-900 p-2 inset-shadow-well">
      {list.map((f) => {
        const on = picked.has(f.userId)
        return (
          <li key={f.userId}>
            <label className={cx('flex cursor-pointer items-center gap-3 px-2 py-1.5 hover:bg-dusk-800', on && 'bg-dusk-800')}>
              <input
                type="checkbox"
                className="size-4 accent-volt-400"
                checked={on}
                onChange={() => {
                  const next = new Set(picked)
                  if (on) next.delete(f.userId)
                  else if (next.size < 7) next.add(f.userId)
                  onChange(next)
                }}
              />
              <span className="flex-1 truncate">{f.trainerName}</span>
              {f.trainerLevel !== undefined && <span className="text-xs text-mist-400">{t('trainer.level', { level: f.trainerLevel })}</span>}
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function minutesLeft(until: number, now: number) {
  return Math.max(0, Math.ceil((until - now) / MINUTE_MS))
}

/** Sky of the scenes: the viewer's local time, like the route band of the home screen. */
function useSceneTime() {
  const player = usePlayer()
  return timeOfDay(toLocal(useNow(), player.profile.timezone).hour)
}

/**
 * The lobby: a scene for the host and everyone who accepted (mine first), and a short list for the invitees
 * who have not answered or cannot come, whose team nobody sees.
 */
function LobbyRoster({ group }: { group: StudyGroupView }) {
  const { t } = useTranslation()
  const meId = useAuth((s) => s.user?.id)
  const time = useSceneTime()
  const people: ScenePlayer[] = [
    { userId: group.hostId, name: group.hostName, trainer: group.hostLook.trainer, team: group.hostLook.team, you: group.hostId === meId, host: true, state: 'ready', stateText: t('group.host') },
    ...group.invites
      .filter((i) => i.status === 'accepted' || i.status === 'joined')
      .map((i): ScenePlayer => ({ userId: i.userId, name: i.trainerName, trainer: i.trainer, team: i.team, you: i.userId === meId, host: false, state: 'ready', stateText: t(`group.inviteStatus.${i.status}`) })),
  ]
  const waiting = group.invites.filter((i) => i.status !== 'accepted' && i.status !== 'joined')
  return (
    <div className="flex flex-col gap-3">
      <GroupRoster players={meFirst(people, meId)} time={time} label={t('group.scene.roster')} />
      {waiting.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {waiting.map((i) => (
            <li key={i.userId} className="flex items-center gap-2 text-sm">
              <PixelIcon name={i.status === 'declined' || i.status === 'failed' ? 'close' : 'clock'} size={16} className="text-mist-400" />
              <span className="flex-1 truncate">{i.trainerName}</span>
              <span className="text-xs text-mist-400">{t(`group.inviteStatus.${i.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function HostLobby({ group }: { group: StudyGroupView }) {
  const { t } = useTranslation()
  const now = useNow()
  const start = useGroups((s) => s.start)
  const leave = useGroups((s) => s.leave)
  const invite = useGroups((s) => s.invite)
  const busy = useGroups((s) => s.busy)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const ready = group.invites.filter((i) => i.status === 'accepted').length
  const waiting = group.invites.filter((i) => i.status === 'pending').length
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist-300">
        {t('group.lobbyHost', { minutes: group.minutes })} {t('group.expiresIn', { count: minutesLeft(group.expiresAt, now) })}
      </p>
      <LobbyRoster group={group} />
      {waiting > 0 && <p className="text-xs text-mist-400">{t('group.lateJoinNote')}</p>}
      {adding ? (
        <div className="flex flex-col gap-3">
          <FriendPicker picked={picked} onChange={setPicked} exclude={group.invites.filter((i) => i.status !== 'declined' && i.status !== 'failed').map((i) => i.userId)} />
          <div className="flex gap-3">
            <Button
              size="sm"
              disabled={busy || picked.size === 0}
              onClick={async () => {
                if (fail(await invite([...picked]))) {
                  setPicked(new Set())
                  setAdding(false)
                }
              }}
            >
              {t('group.sendInvites', { count: picked.size, minutes: group.minutes })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button icon="play" disabled={busy} aria-busy={busy} onClick={async () => void fail(await start())}>
            {t('group.start', { count: ready, minutes: group.minutes })}
          </Button>
          <Button size="sm" variant="secondary" icon="plus" disabled={busy} onClick={() => setAdding(true)}>
            {t('group.inviteMore')}
          </Button>
          <Button size="sm" variant="ghost" icon="close" disabled={busy} onClick={async () => void fail(await leave())}>
            {t('group.disband')}
          </Button>
        </div>
      )}
      {ready === 0 && <p className="text-xs text-mist-400">{t('group.startAloneNote')}</p>}
    </div>
  )
}

function GuestLobby({ group }: { group: StudyGroupView }) {
  const { t } = useTranslation()
  const leave = useGroups((s) => s.leave)
  const busy = useGroups((s) => s.busy)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist-300">{t('group.lobbyGuest', { name: group.hostName, minutes: group.minutes })}</p>
      <LobbyRoster group={group} />
      <p className="text-xs text-mist-400">{t('group.guestNote')}</p>
      <div>
        <Button size="sm" variant="ghost" icon="close" disabled={busy} onClick={async () => void fail(await leave())}>
          {t('group.leaveLobby')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FocusSession: live status
// ---------------------------------------------------------------------------

function memberState(m: StudyGroupMember, now: number): 'in' | 'left' | 'done' {
  if (m.leftAt !== null) return m.leftReason === 'finished' ? 'done' : 'left'
  return now >= m.endsAt ? 'done' : 'in'
}

export function GroupSessionStatus() {
  const FAIRY = useContent().config.conditions.fairy
  const { t, i18n: inst } = useTranslation()
  const now = useNow()
  const player = usePlayer()
  const meId = useAuth((s) => s.user?.id)
  const current = useGroups((s) => s.current)
  const loaded = useGroups((s) => s.loaded)
  const load = useGroups((s) => s.load)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  const time = useSceneTime()
  const session = player.activeSession
  const hasFairy = useTeamHasFairy(session?.startedAt ?? now)
  const g = current && current.me.member ? current : null
  const stats = useMemo(() => {
    if (!g || !meId) return null
    return { sofar: groupOverlap(g.members, meId, now), projected: groupOverlap(g.members, meId) }
  }, [g, meId, now])
  if (!g || !meId || !stats?.sofar || !stats.projected) return null
  const me = g.members.find((m) => m.userId === meId)!
  const players = meFirst(
    g.members.map((m): ScenePlayer => {
      const st = memberState(m, now)
      return {
        userId: m.userId,
        name: m.trainerName,
        trainer: m.trainer,
        team: m.team,
        you: m.userId === meId,
        host: m.userId === g.hostId,
        state: st satisfies SceneState,
        stateText: st === 'in' ? t('group.session.studying') : st === 'done' ? t('group.session.done') : t('group.session.leftBecause', { reason: t(`group.reason.${m.leftReason ?? 'leave'}`) }),
      }
    }),
    meId,
  )
  const iLeft = memberState(me, now) === 'left'
  const othersIn = g.members.filter((m) => m.userId !== meId && memberState(m, now) === 'in')
  const x = Math.floor(stats.sofar.accompaniedMs / MINUTE_MS)
  const y = Math.round(stats.sofar.sessionMs / MINUTE_MS)
  const mult = fairyMultiplier(stats.projected.overlap, FAIRY)
  return (
    <Panel variant="frame" title={t('group.session.title')} headingLevel={2} className="mx-auto w-full max-w-5xl">
      <GroupRoster players={players} time={time} label={t('group.session.members')} />
      <p className="mt-4 flex flex-wrap items-center gap-2 text-mist-100">
        <TypeBadge type="fairy" />
        <span>{t('group.session.accompanied', { x, y })}</span>
        <span aria-hidden>·</span>
        <span className="font-num text-2xl leading-none text-leaf-400">{t('group.session.estimate', { mult: fmtNum(mult) })}</span>
      </p>
      <p className="mt-2 text-sm text-mist-400">
        {iLeft
          ? t('group.session.youLeft', { reason: t(`group.reason.${me.leftReason ?? 'leave'}`) })
          : othersIn.length === 0
            ? t('group.session.alone')
            : t('group.session.pauseWarning')}
      </p>
      {!hasFairy && <p className="mt-1 text-sm text-amber-400">{t('group.session.noFairy')}</p>}
      <p className="sr-only" aria-live="polite">
        {t('group.session.srSummary', { count: othersIn.length, pct: fmtPct(stats.projected.overlap, inst.language) })}
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Results: final Fairy bonus
// ---------------------------------------------------------------------------

export function GroupFairyNote({ result }: { result: SessionResult }) {
  const FAIRY = useContent().config.conditions.fairy
  const player = usePlayer()
  const { t, i18n: inst } = useTranslation()
  const names = useNames()
  const overlap = result.friendOverlap
  if (overlap === null || overlap === undefined) return null
  const y = result.plannedMinutes
  const x = Math.round(overlap * y)
  const mult = fairyMultiplier(overlap, FAIRY)
  const fairyMembers = result.members.filter((m) => m.conditionType === 'fairy' && m.conditionMult > 1)
  const why =
    overlap <= 0
      ? t('group.results.none')
      : fairyMembers.length > 0
        ? t('group.results.applied', { who: fairyMembers.map((m) => names.pokemon(player.pokemon[m.uid], m.speciesSlug)).join(', ') })
        : t('group.results.noFairy')
  return (
    <div className="mt-4 bg-dusk-900/5 p-3 text-sm text-dusk-700 shadow-frame">
      <p className="flex flex-wrap items-center gap-2 font-display text-base text-ink">
        <TypeBadge type="fairy" />
        <span>{t('group.results.title')}</span>
        <span className="font-num text-xl leading-none">×{fmtNum(mult)}</span>
      </p>
      <p className="mt-1">{t('group.results.accompanied', { x, y, pct: fmtPct(overlap, inst.language) })}</p>
      <p className="mt-1">{why}</p>
      <p className="mt-1 text-xs text-dusk-600">{t('group.results.formula', { max: fmtNum(FAIRY) })}</p>
    </div>
  )
}
