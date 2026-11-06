/**
 * Mission kinds: a dependency-free leaf module. `context.ts` needs the value
 * list to validate custom-missions.json, and `missions.ts` needs `context.ts`
 * (to read the shipped content), so the list lives here to keep the import
 * graph acyclic (guarded by no-cycles.test.ts). Public names are re-exported
 * from `missions.ts`.
 */
export type MissionKind =
  | 'sessions'
  | 'studyMinutes'
  | 'longSession'
  | 'studyDays'
  | 'techniques'
  | 'catch'
  | 'catchType'
  | 'catchFirstThrow'
  | 'studyBall'
  | 'evolve'

export const MISSION_KINDS: readonly MissionKind[] = [
  'sessions',
  'studyMinutes',
  'longSession',
  'studyDays',
  'techniques',
  'catch',
  'catchType',
  'catchFirstThrow',
  'studyBall',
  'evolve',
]
