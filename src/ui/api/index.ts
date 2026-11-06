// API layer: typed fetch client, endpoint helpers and server events (docs/F2-plan.md).
export { api, ApiError, errorCode, isApiError, onUnauthorized, type RequestOptions } from './client'
export { authApi, devHeaders, friendsApi, gameApi, leaderboardApi, weatherApi, type RegisterInput } from './endpoints'
export { connectEvents, disconnectEvents, onServerEvent } from './events'
