# PokeFocus engine — public API

`src/engine/` is pure TypeScript: no React, no DOM, no I/O, no `Date.now()`. Import everything from `src/engine` (`index.ts`).

## Conventions

- **Time** is always passed in as epoch milliseconds (`now`, `startedAt`…). Local time comes from `state.profile.timezone`: an IANA name (`'America/Lima'`, DST-aware via `Intl`) or a fixed UTC offset in minutes (`-300`).
- **Randomness** goes through an `Rng` (`createRng(seed: number | string)`, mulberry32). Same seed + same inputs → identical results.
- **State** (`PlayerState`) is plain JSON. Every reducer is pure: it returns a new state and never mutates its input.
- **Fallible operations** return `Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`. `E` is a string-literal union, so the UI can map it to i18n keys.
- **Context**: every function takes an optional last argument `ctx: EngineContext` (default `defaultContext()` = shipped data + config). The simulator builds its own with `createEngineContext({ config?: DeepPartial<GameConfig>, data?, techniques?, abilities? })`; `config` overrides are deep-merged over `custom-game-config.json`. `ctx.warnings` lists problems found in the effect definitions (empty today).
- **Config**: every number comes from `ctx.config` (`custom-game-config.json`). Parameters the engine needs that are not in that file yet live in `ENGINE_DEFAULTS` (`config.ts`) and are merged under the JSON: `session.dailyHalfRewardFactor`, `energy.potions` / `revivePct`, `conditions.earlyMorningWindow`, `encounters.soundProfileTypes` / `nonLevelEvolutionLevelGap`, `capture.counter.immuneHealPct`, `progression.maxLevel`, `trainer.*`, `historyLimit`. Adding them to the JSON overrides the defaults.

## Player state (`state.ts`)

| Field | Meaning |
|---|---|
| `profile` | `trainerName`, `locale`, `timezone` (IANA or offset minutes), `city`, `weather: WeatherInput \| null` (placeholder, set by the app), `createdAt` |
| `trainer` | `{ level, exp }` (EXP = study minutes + bonus per new species caught) |
| `dust` | Study Dust |
| `inventory` | item slug → amount (`poke-ball`, `great-ball`, `ultra-ball`, potions, stones…). The Study Ball never enters it. |
| `candies` | `{ chains: { [evolutionChainId]: n }, types: { [type]: n } }` |
| `pokemon` | uid → `OwnedPokemon` (box + team) |
| `team` | up to 6 uids, compact, `team[0]` = leader |
| `pokedex` | `{ seen: slug[], caught: slug[] }` (caught count drives the level cap) |
| `history` | `SessionSummary[]` (for stats/charts; `caught` is updated by throws) |
| `streak` | `{ current, best, lastDayKey, gapBeforeLastDay, protectUsedWeek }` |
| `league` | `{ weeklyPoints: {weekKey: n}, monthlyPoints: {monthKey: n}, bestLeague }` |
| `roaming` | escaped legendaries `{ speciesSlug, sessionsLeft }` |
| `pendingWishes` | heals applied at the next `startSession` |
| `activeSession` | `ActiveSession \| null` (single active session) |
| `encounter` | `EncounterState \| null`: waves of the last claimed session, current wave, status/reroll charges |
| `days` | dayKey → `{ minutes, sessions, firstStartMinute }` (last 14 days; daily diminishing returns, Poison/Psychic/Steel conditions) |
| `lastSessionEndedAt` | for the Electric condition |
| `techniqueWeekUses`, `counters` | bookkeeping (weekly technique limits, id counters) |

`OwnedPokemon`: `uid, speciesSlug, level, exp (total), ivs, nature, ability, isShiny, bondMinutes, learnedMoves, extraMoves, equippedMoves, moveMasteryMinutes, energy {current, updatedAt}, asleepNextSession, teraType, teraUntil, teraSessionsLeft (stub), caughtAt, caughtBall, metLevel`.

**Extra moves unlock by level** (`progression.extraMoveUnlock`): `extraMoves` stores the 2–3 rolled extras, but each one is only learned/equippable once `level ≥ unlockLevel`. Damage moves: `max(1, round((power − powerOffset) / powerDivisor))` (Solar Beam 120 → 40, Flamethrower 90 → 25, Tackle → 1); special techniques: `statusLevel` (15). Helpers: `extraMoveUnlockLevel(slug)`, `unlockedExtraMoves(p)`, `lockedExtraMoves(p)` → `{ move, unlockLevel }[]`. `levelUp` events include newly unlocked extras in `newMoves`.

`energy.current` is valid as of `energy.updatedAt`; to display "now" use `energyAt(state, p, now)` or `refreshEnergy(state, now)`.

## Starting out

```ts
createNewPlayer({ trainerName, locale, starterSlug, now, timezone?, city? }, rng): Result<PlayerState, 'invalid_starter'>
```
Starter (`config.starters`) at `starterLevel`, 1 technique equipped, `starterPokeBalls` Poké Balls, Pokédex seen/caught.

## Session flow (`session.ts`)

1. ```ts
   startSession(state, { plannedMinutes, startedAt, note?, subjectTag? })
     : Result<{ state, session: ActiveSession }, 'session_active' | 'invalid_duration' | 'empty_team'>
   ```
   Refreshes energy to `startedAt`, applies pending Wish heals (`session.startHeals`), snapshots team, start energy and members asleep from Rest. Only one active session (`state.activeSession`). `cancelSession(state)` abandons it.

2. ```ts
   completeSession(state, session, {
     endedAt, claimedAt, pausedSeconds,
     focusInputs: { screenshotLabels: string[] | null /* null = no permission */, missedCaptures },
     soundProfile?: { silence, music, voice, noise } | null,
     weather?: { rain, sun, snow?, tempC } | null,   // default: state.profile.weather
     friendOverlap?: number | null,                  // 0–1, Fairy condition
   }, rng): Result<SessionResult, 'no_active_session' | 'invalid_times'>
   ```
   Pure simulation. Key `SessionResult` fields:
   - `minutes` = floor(min(planned, elapsed − paused)); `valid` = minutes ≥ `session.minMinutes` (invalid → no rewards, no waves).
   - `lateClaim` (claim > `claimWindowMinutes` after `endedAt`), `rewardFactor` (daily diminishing returns, pro-rated across 360/600 min), `focus` (player focus = screenshot value × late multiplier), `captureValue`.
   - `conditions` (active type conditions at start), `forcedConditions` (activateCondition: type, minute, by whom).
   - `members[]`: `uid, slot, asleep, actions, points, catchEnergy, energyStart/End/Max/Spent/Healed, exhaustedAtMinute, techniques [{move,count}], conditionMult, conditionType, focusEffective, exp, bondMinutes, masteryMinutes, rested`.
   - `totalPoints`, `dust`, `pokeBalls`, `energyByBlock[]` (catch energy per type per 25-min block).
   - `waves[]` (see Encounters), `charges[]` (status / reroll), `extraWild`, `wishes`, `streak`, `roamingAfter`, `league` (league used for wave caps).
   With `rewardFactor = 0` (over 600 min today) the session is recorded but gives nothing and no waves.

3. ```ts
   applySessionResult(state, result): Result<{ state, events: ProgressEvent[] }, 'session_mismatch' | 'already_applied'>
   ```
   Idempotent per session id. Finishes any previous encounter, applies energy (`updatedAt = startedAt`), Rest/asleep flags, EXP + level ups (moves learned, cap), Bond, Mastery, dust, Poké Balls (+1 per Study Ball converted), weekly/monthly points, best league, streak, `days`, trainer EXP, history, Pokédex seen, Wishes, roaming list, and sets `state.encounter` with the waves. Clears `activeSession`.
   `ProgressEvent`: `levelUp {uid, from, to, newMoves, slotsUnlocked}`, `evolutionAvailable {uid, to, trigger}`, `levelCapped {uid, cap}`, `trainerLevelUp`, `leagueUp {from, to}`.

Helpers: `captureValue(focusInputs, cfg, labelFloors?)`, `dailyRewardFactor(minutesBefore, minutes, cfg)`, `validatedMinutes`, `activationChance(baseChance, spDef, masteryMinutes, techChanceMult, cfg)`, `projectStreak`, `conditionTypes(p, at)`.

### Simulation rules (summary)
- Actions are event-driven across the team: interval = `300·60/(60+Speed)` ÷ pace mods. Each action: points `(5 + SpAtk/4) · condition · bond · focusEff · points mods · burst`, catch energy of a random equipped damage technique (`Atk/5 · power/60`; none → Normal at `noDamageMoveEnergyFactor`), energy cost `(0.5 + L/25) · energyCost mods`, then activables roll `min(0.4, base · techMult · mastery · techChance)` up to `limitPerSession` (and `limitPerWeek`), then passive `statusOnAction`, then heal-over-time.
- A Pokémon at 0 energy skips actions (it can act again if healed by a teammate) but still gets EXP/Bond. Members asleep from Rest do not act and do not provide team effects.
- `focusEffective` per member = screenshot value (with its `focusLabelFloor`) × late multiplier (unless `lateClaimImmune`), then Defense share, then `focusFloor`.
- EXP = `24 · minutes · focusEff · exp mods · rewardFactor`; dust = `10 · minutes · focus · rewardFactor`; points ×`rewardFactor`; balls = round(2 · rewardFactor).
- Team-scope statMods and team primitives (`ballMult`, `maxFailedThrows`, `encounterWeight`) don't stack: the strongest member effect wins (lowest for `energyCost`, `counterDamageTaken`).

## Encounters and capture (`capture.ts`, `waves.ts`)

`EncounterState`: `{ sessionId, waves: Wave[], currentWave, charges: Charge[], gen, env }`.
`Wave`: `{ index, wilds: WildPokemon[], studyBall: 'available'|'used'|'lost'|'converted', contributions, activeConditionTypes }`.
`WildPokemon`: individual data (`speciesSlug, level, ivs, nature, ability, isShiny, extraMoves`) + `isLegendary, isRoaming, maxHp, damage, hpFraction (≥ 5%), status, studyBallEligible, guaranteedBall (lowest ball guaranteeing a shiny, null otherwise), failedThrows, nextThrowBonus, outcome: 'pending'|'caught'|'fled', caughtUid`.

```ts
throwBall(state, { waveIndex, wildIndex }, ball: 'study-ball' | BallSlug, rng, now)
  : Result<{ state, outcome: ThrowOutcome }, ThrowError>
```
- Only on the current wave and with no active session. Balls are consumed from the inventory; the Study Ball is one per wave, only for eligible wilds (base form, not legendary, level ≤ 20) and always catches.
- Shiny guarantee: the matching ball or better catches (`guaranteedBall`); legendaries are never guaranteed.
- Otherwise `p = min(1, (1 − 2h/3) · (R/255) · ballMult · teamBallMult · status · nextThrowBonus)`, R ≥ 30 for legendaries.
- `ThrowOutcome`: `caught {uid, chance, guaranteed: 'study'|'shiny'|null}` (added to the box with full energy, +3 candies, Pokédex, roaming entry removed) · `failed {chance, counter, failedThrows, throwsLeft}` · `fled {chance, counter, roaming}` (legendaries become roaming for `roamingSessions` sessions).
- `CounterResult`: `targetUid` (leader, or next member with energy), `attackType` (wild type most effective vs target), `effectiveness, damage, missed, healed, reflected, statusInflicted, survivedWith1, energyAfter`.

Other calls:
- `applyStatusCharge(state, chargeId, ref)` → sets `sleep`/`paralysis` on a pending wild of the current or a later wave.
- `rerollWild(state, chargeId, ref, rng)` → replaces the wild (same wave energy). If no eligible wild remains, the Study Ball converts to a Poké Ball.
- `advanceWave(state)` → next wave (unused Study Ball is lost; pending legendaries become roaming); after the last wave `encounter = null`. `finishEncounter(state)` skips the rest.
- `encounterModifiers(state)` → `{ ballMult, extraFailedThrows, maxFailedThrows, counterNoFirst, revealWildIvs, teamCounterDamageMult }` for the current team (UI: show IVs when `revealWildIvs`).
- `wildCatchChance(state, wild, ball)` → probability to show before throwing.
- Pure building blocks: `captureChance`, `counterDamage`, `resolveCounter`, `typeEffectiveness(attack, defTypes, chart, floors?)`, `computeDamage`, `hpFractionAfter`, `waveCount`, `rollWaveSize`, `rollWild`, `speciesWeight`, `minWildLevel`, `wildLevelRange`, `isStudyBallEligible`, `shinyGuaranteeBall`, `ballCovers`.

## Box (`box.ts`)

All return `Result<…, BoxError>`; Pokémon in the active session are locked.
- `releasePokemon(state, uid)` → candies by stage (1/2/3); team members can't be released.
- `useCandy(state, uid, { kind: 'species' } | { kind: 'type', type }, count)` → `{ state, events, dustSpent }`. Cost `25 + 3·level` per candy at the current level; stops at the level cap (`level_cap` if none could be used).
- `equipMoves(state, uid, moves)` → validates slots (`techniqueSlots(level)`), duplicates, known (learned ∪ extra), unlocked (`move_locked` for an extra move below its unlock level) and usable.
- `setTeam(state, uids, now)` / `setLeader(state, uid, now)` → 1–6 distinct uids, only between sessions; refreshes energy first.
- `evolvePokemon(state, uid, toSlug, now, rng)` → `{ state, pokemon }`. Level, stone (consumed), friendship (Bond ≥ `friendshipEvolutionBond`; day = 05–18, night = otherwise). Errors: `level_too_low`, `missing_item`, `bond_too_low`, `wrong_time_of_day`, `trade_unavailable`, `unsupported`, `no_such_evolution`.
- `addItems(state, { slug: n })`, `levelProgress(p)`.

## Energy (`energy.ts`)
- `refreshEnergy(state, now)` — full refill when the local `dailyResetHour` (05:00) passed since `updatedAt`; box members regenerate `boxRecoverPctPerHour`·max per hour; team members don't regenerate.
- `energyAt(state, p, now)` (pure read), `energyFraction(p)`.
- `completeBreak(state, now)` — team +`breakRecoverPct` of max.
- `useHealItem(state, uid, item, now)` — `potion` 20, `super-potion` 50, `hyper-potion` 120, `revive` 0 → 50%.

## Leagues (`league.ts`)
`weekKey(state, now)` (local Monday `YYYY-MM-DD`), `monthKey`, `weeklyPoints`, `monthlyPoints`, `currentLeague(state, now)` (resets to Base every local Monday 00:00), `currentMaxWaveSize`, `nextLeagueProgress`, `leagueForPoints(points, 'week' | 'month')`.

## Progression (`progression.ts`)
`expForLevel(L)` = `round(4·L^2.8)`, `levelFromExp`, `levelCap(state)` / `levelCapFor(nCaught)`, `candyDustCost(level)`, `bondBonus(minutes)`, `trainerExpForLevel`, `trainerLevelFromExp`, `gainExp(p, amount, cap)`, `applyLevel`, `evolutionOptions(state, p, now)`.

## Data / rules helpers
- Stats: `computeStats(ind)` (curves → formula), `maxEnergyOf`, `effectiveBase`, `statValue`, `actionIntervalSeconds`, `basePointsPerAction`, `catchEnergyPerAction`, `techniqueMultiplier`, `effectiveFocus`, `energyCostPerAction`, `bondMultiplier`, `masteryMultiplier`, `masteryStars`.
- Techniques: `getTechnique(slug)` → `{ kind: 'damage'|'passive'|'activable', type, power, damageClass, def } | null` (null = the move doesn't exist in PokeFocus), `isUsableMove`, `techniqueSlots(level)`, `equippableMoves(p)` (learned + unlocked extras; pass an object with `level`), `extraMoveUnlockLevel`, `unlockedExtraMoves`, `lockedExtraMoves`, `validateEquip`, `defaultEquipped` (new individuals only get unlocked moves).
- Individuals: `createIndividual(slug, level, rng, { shiny?, nature? })`, `toOwnedPokemon(core, uid, now, ball)`, `rollIvs`, `rollAbility`, `definedAbilities`.
- Conditions: `typeConditionMult`, `pokemonConditionMult`, `activeConditionTypes`, `evaluateWhen(when, wc, cfg)`.
- Effects: `passiveEffects(p)`, `teamStatMults`, `teamCaptureMods`, `selfStatMult`.
- Views: `pokemonView(state, uid, now)` → stats, current/max energy, interval, points/action, technique multiplier, actions left, slots, equipped/equippable techniques with mastery stars, `lockedExtraMoves: { technique, unlockLevel }[]` and `extraMoves: { technique, unlockLevel, unlocked }[]` (for "se desbloquea al nivel X"), EXP progress, evolution options.

## Invariants
- At most one `activeSession`; `applySessionResult` is idempotent by session id; throws are refused during an active session.
- Wild `hpFraction` ≥ `capture.minHpFraction`; counters never push energy below 0 (or below 1 with `counterMinHp1`).
- `team.length` 1–6, `team[0]` is the leader; `equippedMoves.length ≤ techniqueSlots(level)`; equipped/learned/extra moves are always usable moves; equipped moves are learned or unlocked extras.
- Abilities are always defined in `custom-abilities.json` (or null if the species defines none).
- Level ≤ level cap (EXP above the cap is kept and applied when the cap rises).
