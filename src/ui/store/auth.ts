/**
 * Auth store: who is signed in (docs/F2-plan.md §Cliente).
 *
 * The session is an HttpOnly cookie, so the client only knows the account it
 * gets from /api/auth/*. `status` starts as 'loading' until GET /auth/me
 * answers. Any 401 from the API (cookie expired or revoked) sends us to
 * 'anon'; so does the SSE 'logout' event. Signing in loads the game doc and
 * opens the event stream; signing out clears the game and friends caches.
 */
import { create } from 'zustand'
import type { AuthSessionInfo, PublicUser } from '../../game/protocol'
import { errorCode, isApiError, onUnauthorized, type ApiError } from '../api/client'
import { authApi, type RegisterInput } from '../api/endpoints'
import { connectEvents, disconnectEvents, onServerEvent } from '../api/events'
import { forgetPushOnSignOut, syncPushOnSignIn } from '../lib/push'
import { useGame } from './game'
import { useFriends } from './social'
import { useTrades } from './trades'

export type AuthStatus = 'loading' | 'anon' | 'authed'

/** Body of PATCH /auth/me (src/game/protocol.ts "Account changes"): every field is optional. */
export interface UpdateMeInput {
  trainerName?: string
  country?: string
  anonymousRankings?: boolean
  /** A slug of the trainer catalogue (`trainerCatalog.ts`), or null for the default character. */
  trainerSprite?: string | null
}

/** 409 codes of PATCH /auth/me for a field still inside its lock window. */
export function isAccountLockError(e: unknown): e is ApiError {
  return isApiError(e) && e.status === 409 && (e.code === 'name_locked' || e.code === 'country_locked')
}

export interface AuthState {
  status: AuthStatus
  user: PublicUser | null
  /** Boot failed for a reason other than "not signed in" (server unreachable): the splash offers a retry. */
  bootError: string | null
  /** GET /auth/me (bootstrap, or after a network error). Never throws. */
  refresh: () => Promise<void>
  /** Throw `ApiError` (invalid_credentials, rate_limited…) for the form to show. */
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  /**
   * PATCH /auth/me: the answer (the new `PublicUser`) replaces `user`. A locked
   * field answers 409 `name_locked` / `country_locked`; the clock or the cached
   * user was stale, so it refreshes the user (the form then shows the real lock)
   * and still throws.
   */
  updateMe: (patch: UpdateMeInput) => Promise<PublicUser>
  changePassword: (current: string, next: string) => Promise<void>
  listSessions: () => Promise<AuthSessionInfo[]>
  revokeSession: (id: string) => Promise<void>
}

function signedIn(user: PublicUser) {
  const was = useAuth.getState()
  const sameUser = was.status === 'authed' && was.user?.id === user.id
  useAuth.setState({ status: 'authed', user })
  if (!sameUser) {
    useGame.getState().clear()
    useFriends.getState().clear()
    useTrades.getState().clear()
    void useGame.getState().load()
    void useFriends.getState().load()
    void useTrades.getState().load()
    // This browser's push subscription (if any) now belongs to this account.
    void syncPushOnSignIn()
  }
  connectEvents()
}

function signedOut() {
  disconnectEvents()
  useGame.getState().clear()
  useFriends.getState().clear()
  useTrades.getState().clear()
  useAuth.setState({ status: 'anon', user: null })
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  user: null,
  bootError: null,

  refresh: async () => {
    set({ bootError: null })
    try {
      const { user } = await authApi.me()
      signedIn(user)
    } catch (e) {
      if (isApiError(e) && e.status === 401) signedOut()
      // Server unreachable: keep the current status (the splash shows a retry while booting).
      else set({ bootError: errorCode(e) })
    }
  },
  login: async (email, password) => {
    const { user } = await authApi.login(email, password)
    signedIn(user)
  },
  register: async (input) => {
    const { user } = await authApi.register(input)
    signedIn(user)
  },
  logout: async () => {
    try {
      // While the cookie still works: the server forgets this browser's push subscription (never throws, gives up after 3 s).
      await forgetPushOnSignOut()
      await authApi.logout()
    } finally {
      signedOut()
    }
  },
  logoutAll: async () => {
    await forgetPushOnSignOut()
    try {
      await authApi.logoutAll()
    } catch (e) {
      void syncPushOnSignIn() // still signed in: give the subscription back
      throw e
    }
    signedOut()
  },
  updateMe: async (patch) => {
    try {
      const { user } = await authApi.updateMe(patch)
      set({ user })
      return user
    } catch (e) {
      if (isAccountLockError(e)) await get().refresh()
      throw e
    }
  },
  changePassword: async (current, next) => {
    await authApi.changePassword(current, next)
  },
  listSessions: async () => (await authApi.sessions()).sessions,
  revokeSession: async (id) => {
    await authApi.revokeSession(id)
  },
}))

onUnauthorized(() => {
  if (useAuth.getState().status !== 'anon') signedOut()
})

onServerEvent((e) => {
  // This session may have been revoked: ask the server (a 401 signs us out).
  if (e.type === 'logout') void useAuth.getState().refresh()
  else if (e.type === 'game' && e.version > useGame.getState().version) void useGame.getState().load()
})
