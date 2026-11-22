import { defaultTrainerSprite } from '../../game/trainers'
import { useAuth } from '../store/auth'

/**
 * Slug of my character: the one I picked, else the stable default for my account (null while signed out).
 * The server only ever sends a valid slug or null, so this does not need the (big) catalogue.
 */
export function useMyTrainer(): string | null {
  return useAuth((s) => (s.user ? (s.user.trainerSprite ?? defaultTrainerSprite(s.user.id)) : null))
}
