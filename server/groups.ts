/**
 * Study groups — domain helpers shared by /api/groups and the game action
 * pipeline (docs/session-depth-plan.md §C).
 *
 * - A group starts as a `lobby` (host + invites). The host's start makes every
 *   accepted invitee start a session with the same minutes at the same instant
 *   (`study_group_members` row = in-group interval joinedAt → leftAt/endsAt).
 * - Pausing, cancelling or leaving takes you out of the group for good; the
 *   session itself continues solo.
 * - At claim the server computes `friendOverlap` from those intervals
 *   (src/game/group.ts) and hands it to the reducer through `ActionEnv`.
 */
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { MINUTE_MS } from '../src/engine'
import { groupOverlap } from '../src/game/group'
import { resolveTrainerSprite } from '../src/game/trainerCatalog'
import type {
  GameActionType,
  GameDoc,
  GroupEventKind,
  GroupInviteStatus,
  GroupLeaveReason,
  GroupLook,
  GroupMon,
  StudyGroupInvite,
  StudyGroupMember,
  StudyGroupStatus,
  StudyGroupView,
} from '../src/game/protocol'
import type { Db, Tx } from './db/client'
import { playerDocs, studyGroupInvites, studyGroupMembers, studyGroups, users } from './db/schema'
import type { Deps } from './http'

type Q = Db | Tx

/** A lobby lapses if the host does not start it within this time. */
export const LOBBY_TTL_MS = 30 * MINUTE_MS
/** Host included. */
export const MAX_GROUP_SIZE = 8

export type GroupRow = typeof studyGroups.$inferSelect
export type MemberRow = typeof studyGroupMembers.$inferSelect
export type InviteRow = typeof studyGroupInvites.$inferSelect

export interface PendingGroupEvent {
  groupId: string
  kind: GroupEventKind
  reason?: GroupLeaveReason
  /** Defaults to the user who made the request. */
  actor?: { id: string; trainerName: string }
}

/** Lobby past its TTL counts as ended. */
export function effectiveStatus(g: GroupRow, now: number): StudyGroupStatus {
  if (g.status === 'lobby' && g.expiresAt.getTime() <= now) return 'ended'
  return g.status
}

/** A started group still has someone studying in it (late joins make sense). */
export function isJoinable(g: GroupRow, members: MemberRow[], now: number): boolean {
  if (g.status !== 'started' || g.expiresAt.getTime() <= now) return false
  return members.some((m) => m.leftAt === null && m.endsAt.getTime() > now)
}

export function toMemberSpan(m: MemberRow) {
  return { userId: m.userId, joinedAt: m.joinedAt.getTime(), endsAt: m.endsAt.getTime(), leftAt: m.leftAt?.getTime() ?? null }
}

export async function membersOf(q: Q, groupId: string): Promise<MemberRow[]> {
  return q.select().from(studyGroupMembers).where(eq(studyGroupMembers.groupId, groupId))
}

/** Member row of the user's current session (by game session id), if it was started in a group. */
export async function memberOfSession(q: Q, userId: string, sessionId: string): Promise<MemberRow | null> {
  const [m] = await q
    .select()
    .from(studyGroupMembers)
    .where(and(eq(studyGroupMembers.userId, userId), eq(studyGroupMembers.sessionId, sessionId)))
    .limit(1)
  return m ?? null
}

/**
 * `friendOverlap` for the session being claimed: null when it was not a group
 * session, else accompanied time ÷ session length (0–1).
 *
 * `cancelledAt` (a long session cancelled before its end, GDD §3.4): the
 * accompanied time up to then ÷ the time elapsed since joining (pauses
 * included, so it never overstates the share).
 */
export async function claimOverlap(tx: Tx, userId: string, before: GameDoc, cancelledAt?: number): Promise<number | null> {
  const session = before.player?.activeSession
  if (!session) return null
  const me = await memberOfSession(tx, userId, session.id)
  if (!me) return null
  const members = await membersOf(tx, me.groupId)
  if (cancelledAt === undefined) return groupOverlap(members.map(toMemberSpan), userId)?.overlap ?? 0
  const o = groupOverlap(members.map(toMemberSpan), userId, cancelledAt)
  if (!o) return 0
  return Math.min(1, Math.max(0, o.accompaniedMs / Math.max(1, cancelledAt - me.joinedAt.getTime())))
}

/**
 * Keep the group membership in line with the game doc after an action:
 * - the group session ended (claim → `finished`, cancel/other → `cancel`);
 * - `pause` → leaves the group (`pause`);
 * - a solo `start` (not through a group) drops the user's open lobbies:
 *   hosted ones are disbanded, accepted invites become declined.
 */
export async function syncGroupMembership(
  tx: Tx,
  userId: string,
  before: GameDoc,
  after: GameDoc,
  actionType: GameActionType,
  now: number,
  viaGroup: boolean,
): Promise<PendingGroupEvent[]> {
  const events: PendingGroupEvent[] = []
  const prev = before.player?.activeSession ?? null
  const next = after.player?.activeSession ?? null
  if (prev) {
    const m = await memberOfSession(tx, userId, prev.id)
    if (m && m.leftAt === null) {
      let reason: GroupLeaveReason | null = null
      if (next?.id !== prev.id) reason = actionType === 'claim' ? 'finished' : 'cancel'
      else if (actionType === 'pause' && after.timer?.pausedAt != null) reason = 'pause'
      if (reason) {
        const leftAt = new Date(Math.min(now, m.endsAt.getTime()))
        await tx
          .update(studyGroupMembers)
          .set({ leftAt, leftReason: reason })
          .where(and(eq(studyGroupMembers.groupId, m.groupId), eq(studyGroupMembers.userId, userId)))
        events.push({ groupId: m.groupId, kind: 'leave', reason })
      }
    }
  }
  if (actionType === 'start' && !viaGroup && next && next.id !== prev?.id) events.push(...(await dropLobbies(tx, userId, now)))
  return events
}

/** Leave every open lobby of the user (host → disband, accepted → declined). */
export async function dropLobbies(tx: Tx, userId: string, now: number, except?: string): Promise<PendingGroupEvent[]> {
  const events: PendingGroupEvent[] = []
  const hosted = await tx
    .select({ id: studyGroups.id })
    .from(studyGroups)
    .where(and(eq(studyGroups.hostId, userId), eq(studyGroups.status, 'lobby')))
  for (const g of hosted) {
    if (g.id === except) continue
    await tx.update(studyGroups).set({ status: 'ended' }).where(eq(studyGroups.id, g.id))
    events.push({ groupId: g.id, kind: 'disband' })
  }
  const accepted = await tx
    .select({ groupId: studyGroupInvites.groupId })
    .from(studyGroupInvites)
    .innerJoin(studyGroups, eq(studyGroups.id, studyGroupInvites.groupId))
    .where(and(eq(studyGroupInvites.inviteeId, userId), eq(studyGroupInvites.status, 'accepted'), eq(studyGroups.status, 'lobby')))
  for (const i of accepted) {
    if (i.groupId === except) continue
    await tx
      .update(studyGroupInvites)
      .set({ status: 'declined', respondedAt: new Date(now) })
      .where(and(eq(studyGroupInvites.groupId, i.groupId), eq(studyGroupInvites.inviteeId, userId)))
    events.push({ groupId: i.groupId, kind: 'decline' })
  }
  return events
}

/** An open lobby the user hosts or accepted (not past its TTL). */
export async function openLobbyOf(q: Q, userId: string, now: number): Promise<GroupRow | null> {
  const [hosted] = await q
    .select()
    .from(studyGroups)
    .where(and(eq(studyGroups.hostId, userId), eq(studyGroups.status, 'lobby')))
  if (hosted && effectiveStatus(hosted, now) === 'lobby') return hosted
  const rows = await q
    .select({ g: studyGroups })
    .from(studyGroupInvites)
    .innerJoin(studyGroups, eq(studyGroups.id, studyGroupInvites.groupId))
    .where(and(eq(studyGroupInvites.inviteeId, userId), eq(studyGroupInvites.status, 'accepted'), eq(studyGroups.status, 'lobby')))
  return rows.map((r) => r.g).find((g) => effectiveStatus(g, now) === 'lobby') ?? null
}

/** Everyone who should hear about changes: host, invitees still involved, members. */
export async function participantIds(q: Q, groupId: string): Promise<string[]> {
  const [g] = await q.select({ hostId: studyGroups.hostId }).from(studyGroups).where(eq(studyGroups.id, groupId))
  if (!g) return []
  const inv = await q
    .select({ id: studyGroupInvites.inviteeId })
    .from(studyGroupInvites)
    .where(and(eq(studyGroupInvites.groupId, groupId), ne(studyGroupInvites.status, 'declined')))
  const mem = await q.select({ id: studyGroupMembers.userId }).from(studyGroupMembers).where(eq(studyGroupMembers.groupId, groupId))
  return [...new Set([g.hostId, ...inv.map((r) => r.id), ...mem.map((r) => r.id)])]
}

/** Publish `group` SSE events (after the transaction committed). */
export async function publishGroupEvents(
  deps: Deps,
  actor: { id: string; trainerName: string },
  events: PendingGroupEvent[],
  extraRecipients: string[] = [],
): Promise<void> {
  for (const ev of events) {
    const who = ev.actor ?? actor
    const ids = new Set([...(await participantIds(deps.db, ev.groupId)), ...extraRecipients, who.id])
    for (const id of ids) {
      deps.bus.publish(id, {
        type: 'group',
        groupId: ev.groupId,
        kind: ev.kind,
        userId: who.id,
        trainerName: who.trainerName,
        ...(ev.reason ? { reason: ev.reason } : {}),
      })
    }
  }
}

/** In the group: the host, the members and the invitees that accepted (or already joined). */
const inGroup = (i: InviteRow) => i.status === 'accepted' || i.status === 'joined'

/**
 * May `viewerId` see the teams of this group? Only people who are in it (host, member, accepted invitee: a pending
 * or declined invitee sees nobody's team), and only while it is alive: a lobby that has not lapsed, or a started
 * group while any member's session is still running (a started group never turns `ended` by itself, so without
 * this window a former member could keep polling GET /groups/:id).
 */
export function teamsVisible(g: GroupRow, members: MemberRow[], invites: InviteRow[], viewerId: string, now: number): boolean {
  if (effectiveStatus(g, now) === 'ended') return false
  const entitled = g.hostId === viewerId || members.some((m) => m.userId === viewerId) || invites.some((i) => i.inviteeId === viewerId && inGroup(i))
  if (!entitled) return false
  return g.status === 'lobby' || members.some((m) => m.endsAt.getTime() > now)
}

/**
 * The team of each user as the scenes show it: up to 6 `{slug, shiny}`, leader first. It is the team of the running
 * session (`activeSession.teamUids`, a snapshot taken at start) or else the saved team, i.e. what `heals` also
 * treats as "their team". Read live from the player doc, in SQL, so only these few fields leave the database.
 */
export async function teamsOf(q: Q, userIds: string[]): Promise<Map<string, GroupMon[]>> {
  const out = new Map<string, GroupMon[]>()
  if (userIds.length === 0) return out
  const d = playerDocs.doc
  const rows = await q
    .select({
      id: playerDocs.userId,
      // `::text` so the driver does not decide how to parse the jsonb (postgres-js and PGlite differ).
      team: sql<string | null>`(
        select jsonb_agg(jsonb_build_object('uid', t.uid, 'slug', m.p ->> 'speciesSlug', 'shiny', coalesce((m.p ->> 'isShiny')::boolean, false), 'copyOf', m.p ->> 'copyOfUid') order by t.ord)
        from jsonb_array_elements_text(coalesce(${d} #> '{player,activeSession,teamUids}', ${d} #> '{player,team}', '[]'::jsonb)) with ordinality as t(uid, ord)
        cross join lateral (select ${d} #> array['player', 'pokemon', t.uid] as p) m
        where t.ord <= 6 and m.p is not null
      )::text`,
    })
    .from(playerDocs)
    .where(inArray(playerDocs.userId, userIds))
  for (const r of rows) out.set(r.id, r.team ? lookOfTeam(JSON.parse(r.team) as TeamRow[]) : [])
  return out
}

/** A team member as read from the player doc: `uid` and `copyOf` are internal and never leave `teamsOf`. */
interface TeamRow extends GroupMon {
  uid: string
  copyOf: string | null
}

/**
 * A Pokémon copying a teammate (Ditto, `copyOfUid`) is drawn as that teammate, but keeps its own shiny flag. The copy
 * only counts while the copied Pokémon is in this same team (the engine ensures it is never a transformer itself).
 * Returns only `{slug, shiny}`: nothing else of the team leaks.
 */
function lookOfTeam(team: TeamRow[]): GroupMon[] {
  const slugOf = new Map(team.map((m) => [m.uid, m.slug]))
  return team.map((m) => {
    const copied = m.copyOf && m.copyOf !== m.uid ? slugOf.get(m.copyOf) : undefined
    return { slug: copied ?? m.slug, shiny: m.shiny }
  })
}

/** Full view of a group for one viewer. */
export async function groupView(q: Q, g: GroupRow, viewerId: string, now: number): Promise<StudyGroupView> {
  const members = await membersOf(q, g.id)
  const invites = await q.select().from(studyGroupInvites).where(eq(studyGroupInvites.groupId, g.id))
  const ids = [...new Set([g.hostId, ...members.map((m) => m.userId), ...invites.map((i) => i.inviteeId)])]
  const people = await q.select({ id: users.id, name: users.trainerName, sprite: users.trainerSprite }).from(users).where(inArray(users.id, ids))
  const person = new Map(people.map((p) => [p.id, p]))
  const name = (id: string) => person.get(id)?.name ?? '?'
  // Teams: only of people in the group, and only if the viewer may see them (see `teamsVisible`).
  const showTeams = teamsVisible(g, members, invites, viewerId, now)
  const inside = new Set([g.hostId, ...members.map((m) => m.userId), ...invites.filter(inGroup).map((i) => i.inviteeId)])
  const teams = showTeams ? await teamsOf(q, [...inside]) : new Map<string, GroupMon[]>()
  const look = (id: string): GroupLook => {
    const team = inside.has(id) ? (teams.get(id) ?? []) : []
    return { trainer: resolveTrainerSprite(id, person.get(id)?.sprite), leader: team[0] ?? null, team }
  }
  const memberViews: StudyGroupMember[] = members
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
    .map((m) => ({ ...toMemberSpan(m), trainerName: name(m.userId), leftReason: m.leftReason ?? null, ...look(m.userId) }))
  const inviteViews: StudyGroupInvite[] = invites
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((i) => ({ userId: i.inviteeId, trainerName: name(i.inviteeId), status: i.status, ...look(i.inviteeId) }))
  const myInvite = invites.find((i) => i.inviteeId === viewerId)
  return {
    id: g.id,
    hostId: g.hostId,
    hostName: name(g.hostId),
    hostLook: look(g.hostId),
    minutes: g.minutes,
    status: effectiveStatus(g, now),
    createdAt: g.createdAt.getTime(),
    startedAt: g.startedAt?.getTime() ?? null,
    expiresAt: g.expiresAt.getTime(),
    members: memberViews,
    invites: inviteViews,
    me: { host: g.hostId === viewerId, invite: (myInvite?.status as GroupInviteStatus | undefined) ?? null, member: members.some((m) => m.userId === viewerId) },
  }
}

/** Pending invites the user can still answer (lobby alive, or started and joinable). */
export async function pendingInvitesOf(q: Q, userId: string, now: number): Promise<GroupRow[]> {
  const rows = await q
    .select({ g: studyGroups })
    .from(studyGroupInvites)
    .innerJoin(studyGroups, eq(studyGroups.id, studyGroupInvites.groupId))
    .where(and(eq(studyGroupInvites.inviteeId, userId), eq(studyGroupInvites.status, 'pending'), or(eq(studyGroups.status, 'lobby'), eq(studyGroups.status, 'started'))))
  const out: GroupRow[] = []
  for (const { g } of rows) {
    const st = effectiveStatus(g, now)
    if (st === 'lobby' || (st === 'started' && isJoinable(g, await membersOf(q, g.id), now))) out.push(g)
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Members still in the group (for "who is studying"). */
export function activeMembers(members: MemberRow[], now: number): MemberRow[] {
  return members.filter((m) => m.leftAt === null && m.endsAt.getTime() > now)
}
