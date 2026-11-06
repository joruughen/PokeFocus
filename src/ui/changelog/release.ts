/**
 * Where the game stands: the release stage shown in the app ("Alfa") and the
 * current version.
 *
 * To change the stage, edit RELEASE_STAGE (the badge, its tooltip and the
 * changelog page follow). To ship a version, add an entry at the top of
 * `entries.ts` and bump `version` in package.json (changelog.test.ts checks
 * that both agree).
 */
import { CHANGELOG } from './entries'

export type ReleaseStage = 'alpha' | 'beta'

/**
 * alpha: core loop works but features are still missing and big changes are expected.
 * beta: feature-complete enough to be stable; only polish and fixes.
 */
export const RELEASE_STAGE: ReleaseStage = 'alpha'

/** Version of the newest changelog entry. */
export const APP_VERSION: string = CHANGELOG[0]!.version
