/**
 * In-memory pub/sub for Server-Sent Events, keyed by user id (one process only:
 * with several server instances this would need Postgres LISTEN/NOTIFY or Redis).
 */
import type { ServerEvent } from '../src/game/protocol'

export interface Subscriber {
  userId: string
  /** auth_sessions.id of the connection (for targeted `logout`). */
  sessionId: string
  send(event: ServerEvent): void
  close(): void
}

export class EventBus {
  private byUser = new Map<string, Set<Subscriber>>()
  private closing = new WeakSet<Subscriber>()

  subscribe(sub: Subscriber): () => void {
    let set = this.byUser.get(sub.userId)
    if (!set) this.byUser.set(sub.userId, (set = new Set()))
    set.add(sub)
    return () => {
      const s = this.byUser.get(sub.userId)
      if (!s) return
      s.delete(sub)
      if (s.size === 0) this.byUser.delete(sub.userId)
    }
  }

  publish(userId: string, event: ServerEvent): void {
    for (const sub of this.byUser.get(userId) ?? []) safe(() => sub.send(event))
  }

  /** Send an event to every open connection (e.g. the live content changed). */
  broadcast(event: ServerEvent): void {
    for (const set of this.byUser.values()) for (const sub of [...set]) safe(() => sub.send(event))
  }

  /** Tell the connections of these sessions they were revoked, then close them. */
  logoutSessions(userId: string, sessionIds: Iterable<string>): void {
    const ids = new Set(sessionIds)
    for (const sub of [...(this.byUser.get(userId) ?? [])]) {
      if (!ids.has(sub.sessionId)) continue
      safe(() => sub.send({ type: 'logout' }))
      safe(() => sub.close())
    }
  }

  /** Close the player's oldest connection that is not already closing (keeps at most N per player). */
  evictOldest(userId: string): void {
    for (const sub of this.byUser.get(userId) ?? []) {
      if (this.closing.has(sub)) continue
      this.closing.add(sub)
      safe(() => sub.close())
      return
    }
  }

  /** Open connections and distinct players connected right now (this process only). */
  audience(): { connections: number; players: number } {
    return { connections: this.count(), players: this.byUser.size }
  }

  count(userId?: string): number {
    if (userId) return this.byUser.get(userId)?.size ?? 0
    let n = 0
    for (const s of this.byUser.values()) n += s.size
    return n
  }
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    // best effort: a dead connection is cleaned up by its own abort handler
  }
}
