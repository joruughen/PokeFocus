/**
 * Which ball stays selected when the selection becomes unusable (QA R-08).
 * The Study Ball is usable only on a wild it is eligible for, so picking another
 * wild can leave the player on a disabled Study Ball: move to the first usable ball.
 * Keeps the current ball when it is usable, or when nothing is (the screen then
 * explains why the throw is disabled).
 */
export function usableBall<B extends string>(current: B, balls: readonly { ball: B; usable: boolean }[]): B {
  if (balls.find((b) => b.ball === current)?.usable) return current
  return balls.find((b) => b.usable)?.ball ?? current
}
