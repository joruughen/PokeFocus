/** Integration tests for nicknames and saved teams through POST /api/game/action (server is the authority). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ActionResponse, GameAction, GameSnapshot, PublicUser } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { loadEnv } from './env'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 4, 15, 0)

let database: Database
let now = T0
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  app = createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '0' }), db: database.db, clock: () => now })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

let ipSeq = 0
async function call(method: string, path: string, cookie: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.2.0.${++ipSeq % 250}` }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (cookie) headers.cookie = `pf_session=${cookie}`
  const res = await app.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, res }
}

const act = (cookie: string, a: GameAction) => call('POST', '/api/game/action', cookie, a)

let seq = 0
async function newUser() {
  const n = ++seq
  const r = await call('POST', '/api/auth/register', null, { email: `team${n}@test.dev`, password: 'correct horse', trainerName: `Teamer ${n}`, country: 'PE' })
  expect(r.status).toBe(201)
  const cookie = r.res.headers.get('set-cookie')!.match(/pf_session=([^;]*)/)![1]!
  const user = (r.json as { user: PublicUser }).user
  expect((await act(cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'bulbasaur' })).status).toBe(200)
  return { cookie, user }
}

describe('nicknames over HTTP', () => {
  it('stores a trimmed nickname and removes it; the reducer rejects what the schema lets through', async () => {
    const u = await newUser()
    const ok = await act(u.cookie, { type: 'setNickname', uid: 'p1', nickname: '  Monito ' })
    expect(ok.status).toBe(200)
    expect((ok.json as unknown as ActionResponse).doc.player?.pokemon.p1?.nickname).toBe('Monito')

    // 13 wide characters: passes the raw-length schema, fails the grapheme rule (409 from the reducer).
    const long = await act(u.cookie, { type: 'setNickname', uid: 'p1', nickname: 'WWWWWWWWWWWWW' })
    expect(long.status).toBe(409)
    expect(long.json).toMatchObject({ error: 'nickname_too_long' })
    const ctrl = await act(u.cookie, { type: 'setNickname', uid: 'p1', nickname: 'a\nb' })
    expect(ctrl.status).toBe(409)
    expect(ctrl.json).toMatchObject({ error: 'nickname_invalid' })
    // Raw text far over the cap never reaches the reducer (400).
    expect((await act(u.cookie, { type: 'setNickname', uid: 'p1', nickname: 'x'.repeat(500) })).status).toBe(400)
    expect((await act(u.cookie, { type: 'setNickname', uid: 'nope', nickname: 'x' })).json).toMatchObject({ error: 'unknown_pokemon' })

    const gone = await act(u.cookie, { type: 'setNickname', uid: 'p1', nickname: null })
    expect((gone.json as unknown as ActionResponse).doc.player?.pokemon.p1?.nickname).toBeUndefined()
    const snap = (await call('GET', '/api/game', u.cookie)).json as unknown as GameSnapshot
    expect(snap.doc.player?.pokemon.p1 && 'nickname' in snap.doc.player.pokemon.p1).toBe(false)
  })

  it('friends see species and level, never the nickname', async () => {
    const a = await newUser()
    const b = await newUser()
    await act(a.cookie, { type: 'setNickname', uid: 'p1', nickname: 'Secreto' })
    const sent = await call('POST', '/api/friends/request', a.cookie, { friendCode: b.user.friendCode })
    expect(sent.status).toBe(201)
    expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.cookie)).status).toBe(204)
    const list = await call('GET', '/api/friends', b.cookie)
    expect(list.status).toBe(200)
    const text = JSON.stringify(list.json)
    expect(text).toContain('bulbasaur')
    expect(text).not.toContain('Secreto')
    expect(text).not.toContain('nickname')
  })
})

describe('saved teams over HTTP', () => {
  it('saves, applies, renames and deletes; validates names and the limit', async () => {
    const u = await newUser()
    const saved = await act(u.cookie, { type: 'savePreset', name: ' Estudio ' })
    expect(saved.status).toBe(200)
    expect((saved.json as unknown as ActionResponse<'savePreset'>).result).toEqual({ id: 't1' })
    expect((await act(u.cookie, { type: 'savePreset', name: '   ' })).json).toMatchObject({ error: 'preset_name_empty' })
    expect((await act(u.cookie, { type: 'savePreset', name: 'x'.repeat(21) })).json).toMatchObject({ error: 'preset_name_too_long' })
    expect((await act(u.cookie, { type: 'renamePreset', id: 't1', name: 'Repaso' })).status).toBe(200)
    const applied = await act(u.cookie, { type: 'applyPreset', id: 't1' })
    expect((applied.json as unknown as ActionResponse<'applyPreset'>).result).toEqual({ missing: 0 })
    expect((await act(u.cookie, { type: 'applyPreset', id: 'nope' })).status).toBe(409)
    for (let i = 0; i < 9; i++) expect((await act(u.cookie, { type: 'savePreset', name: `T${i}` })).status).toBe(200)
    expect((await act(u.cookie, { type: 'savePreset', name: 'one more' })).json).toMatchObject({ error: 'too_many_presets' })
    expect((await act(u.cookie, { type: 'deletePreset', id: 't1' })).status).toBe(200)
    expect((await act(u.cookie, { type: 'deletePreset', id: 't1' })).status).toBe(409)
  })

  it('refuses to switch teams during a session (409 session_active)', async () => {
    const u = await newUser()
    await act(u.cookie, { type: 'savePreset', name: 'Uno' })
    expect((await act(u.cookie, { type: 'start', minutes: 25 })).status).toBe(200)
    const r = await act(u.cookie, { type: 'applyPreset', id: 't1' })
    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ error: 'session_active' })
  })
})
