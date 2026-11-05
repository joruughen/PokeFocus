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
import { errorCode, isApiError, onUnauthorized } from '../api/client'
import { authApi, type RegisterInput } from '../api/endpoints'
import { connectEvents, disconnectEvents, onServerEvent } from '../api/events'
import { useGame } from './game'
import { useFriends } from './social'

export type AuthStatus = 'loading' | 'anon' | 'authed'

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
  updateMe: (patch: { trainerName?: string; country?: string }) => Promise<PublicUser>
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
    void useGame.getState().load()
    void useFriends.getState().load()
  }
  connectEvents()
}

function signedOut() {
  disconnectEvents()
  useGame.getState().clear()
  useFriends.getState().clear()
  useAuth.setState({ status: 'anon', user: null })
}

export const useAuth = create<AuthState>()((set) => ({
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
      await authApi.logout()
    } finally {
      signedOut()
    }
  },
  logoutAll: async () => {
    await authApi.logoutAll()
    signedOut()
  },
  updateMe: async (patch) => {
    const { user } = await authApi.updateMe(patch)
    set({ user })
    return user
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
