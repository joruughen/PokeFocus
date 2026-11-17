# PokeFocus engine — public API

`src/engine/` is pure TypeScript: no React, no DOM, no I/O, no `Date.now()`. Import everything from `src/engine` (`index.ts`).

## Conventions

- **Time** is always passed in as epoch milliseconds (`now`, `startedAt`…). Local time comes from `state.profile.timezone`: an IANA name (`'America/Lima'`, DST-aware via `Intl`) or a fixed UTC offset in minutes (`-300`).
- **Randomness** goes through an `Rng` (`createRng(seed: number | string)`, mulberry32). Same seed + same inputs → identical results.
- **State** (`PlayerState`) is plain JSON. Every reducer is pure: it returns a new state and never mutates its input.
- **Fallible operations** return `Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`. `E` is a string-literal union, so the UI can map it to i18n keys.
- **Context**: every function takes an optional last argument `ctx: EngineContext` (default `defaultContext()` = shipped data + config). The simulator builds its own with `createEngineContext({ config?: DeepPartial<GameConfig>, data?, techniques?, abilities?, missions?, contentHash?, spawn?, events?, warnings? })` (the last four come from `resolveContent`, see «Contenido en vivo»); `config` overrides are deep-merged over `custom-game-config.json`. `ctx.warnings` lists problems found in the effect definitions and, with live content, the unknown slugs or keys a patch referenced (empty with the shipped data).
- **Config**: every number comes from `ctx.config` (`custom-game-config.json`). Parameters the engine needs that are not in that file yet live in `ENGINE_DEFAULTS` (`config.ts`) and are merged under the JSON: `session.dailyHalfRewardFactor`, `energy.potions` / `revivePct`, `conditions.earlyMorningWindow`, `encounters.soundProfileTypes` / `nonLevelEvolutionLevelGap`, `capture.counter.immuneHealPct`, `capture.counter.damageMult` (1; the JSON sets the tuned value), `progression.maxLevel`, `trainer.*`, `historyLimit`. Adding them to the JSON overrides the defaults.
- **Config keys added with the damage/missions pass** (in the JSON): `capture.captureDamageScale` (0.065), `capture.levelSync` (`{ ratio: 1, gap: 0 }`), `capture.damageReferenceSpeed` (70), `capture.hitTargeting` (`'maxHp'`), `encounters.studyBallLevelMargin` (10).

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
| `league` | `{ weeklyPoints: {weekKey: n}, monthlyPoints: {monthKey: n}, bestLeague, bestRank?, podiumSettled? }` (`bestRank`: best ladder position, absent in older saves = first subrank of `bestLeague`; `podiumSettled`: last 8 week keys whose podium was closed) |
| `roaming` | escaped legendaries `{ speciesSlug, sessionsLeft }` |
| `pendingWishes` | heals applied at the next `startSession` |
| `pendingLevelUps?` | `PendingLevelUp[]` = `{ from, to, items, dust, at }`: trainer level-ups whose "Congratulations" window is still to be shown (rewards are already in `inventory`/`dust`). Emptied by the `ackLevelUp` action. Absent in older saves = none. At most `MAX_PENDING_LEVEL_UPS` (20; the oldest two merge) |
| `activeSession` | `ActiveSession \| null` (single active session) |
| `encounter` | `EncounterState \| null`: waves of the last claimed session, current wave, status/reroll charges |
| `days` | dayKey → `{ minutes, sessions, firstStartMinute }` (last 14 days; daily diminishing returns, Poison/Psychic/Steel conditions) |
| `lastSessionEndedAt` | for the Electric condition |
| `techniqueWeekUses`, `counters` | bookkeeping (weekly technique limits, id counters) |
| `missions?` | `{ daily: { key, slots }, weekly: { key, slots }, pokedexClaimed }` (optional: older saves get it lazily; read it through `missionsView`) |

`OwnedPokemon`: `uid, speciesSlug, level, exp (total), ivs, nature, ability, isShiny, bondMinutes, learnedMoves, extraMoves, equippedMoves, moveMasteryMinutes, energy {current, updatedAt}, asleepNextSession, asleepSetAt?, teraType, teraUntil, teraSessionsLeft, mintNature?, bottleCapped?, tmMoves?, caughtAt, caughtBall, metLevel`. The last three are optional (older saves load as they are); see «Advanced items».

**Rest sleep** (`asleepNextSession`): set when Rest fires (`asleepSetAt` = session end). It ends after the next session the Pokémon is in (it skips it), when it sits out a completed session (boxed), or at the daily energy reset (05:00 local; `refreshEnergy` clears it). To show "asleep" use `isAsleepAt(state, p, now)`, not the raw flag.

**Extra moves unlock by level** (`progression.extraMoveUnlock`): `extraMoves` stores the 2–3 rolled extras, but each one is only learned/equippable once `level ≥ unlockLevel`. Damage moves: `max(1, round((power − powerOffset) / powerDivisor))` (Solar Beam 120 → 40, Flamethrower 90 → 25, Tackle → 1); special techniques: `statusLevel` (15). Helpers: `extraMoveUnlockLevel(slug)`, `unlockedExtraMoves(p)`, `lockedExtraMoves(p)` → `{ move, unlockLevel }[]`. `levelUp` events include newly unlocked extras in `newMoves`.

`energy.current` is valid as of `energy.updatedAt`; to display "now" use `energyAt(state, p, now)` or `refreshEnergy(state, now)`.

## Starting out

```ts
createNewPlayer({ trainerName, locale, starterSlug, now, timezone?, city? }, rng): Result<PlayerState, 'invalid_starter'>
```
Starter (`config.starters`) at `starterLevel`, 1 technique equipped, `starterPokeBalls` Poké Balls, Pokédex seen/caught, today's/this week's missions.

## Session flow (`session.ts`)

1. ```ts
   startSession(state, { plannedMinutes, startedAt, note?, subjectTag? })
     : Result<{ state, session: ActiveSession }, 'session_active' | 'invalid_duration' | 'empty_team'>
   ```
   Refreshes energy to `startedAt`, applies pending Wish heals (`session.startHeals`), snapshots team, start energy and members asleep from Rest. Only one active session (`state.activeSession`). `cancelSession(state)` abandons it without rewards. `cancelKeep(planned, studiedMinutes, cfg)` is the cancel rule (GDD §3.4): a session planned longer than one block keeps the minutes studied from `minMinutes` on, and `fullBlocks(minutes)` waves; then the reducer resolves it with `completeSession(..., { cancelled: true })` (never late, `floor(min/25)` waves — possibly 0 —, no per-session Poké Balls, no roaming tick without waves; `SessionResult.cancelled` / `SessionSummary.cancelled`; the mission event does not count it as a completed session).

2. ```ts
   completeSession(state, session, {
     endedAt, claimedAt, pausedSeconds,
     focusInputs: { screenshotLabels: string[] | null /* null = production: base value 1.0; labels are dev-panel only */, missedCaptures },
     soundProfile?: { silence, music, voice, noise } | null,
     weather?: { rain, sun, snow?, tempC } | null,   // default: state.profile.weather (the app always passes it: the manual weather is dev-only)
     friendOverlap?: number | null,                  // 0–1 accompanied share (study group, server-computed); Fairy = 1 + (fairy − 1) × overlap
   }, rng): Result<SessionResult, 'no_active_session' | 'invalid_times'>
   ```
   Pure simulation. Key `SessionResult` fields:
   - `minutes` = floor(min(planned, elapsed − paused)); `valid` = minutes ≥ `session.minMinutes` (invalid → no rewards, no waves).
   - `lateClaim` (claim > `claimWindowMinutes` after `endedAt`), `rewardFactor` (daily diminishing returns, pro-rated across 360/600 min), `focus` (session focus = `focus.baseValue` 1.0, or the dev-panel label value, × `lateClaimMultiplier` 0.5 when late), `captureValue`.
   - `conditions` (active type conditions at start), `forcedConditions` (activateCondition: type, minute, by whom).
   - `members[]`: `uid, slot, asleep, actions, points, catchEnergy, energyStart/End/Max/Spent/Healed, exhaustedAtMinute, techniques [{move,count}], conditionMult, conditionType, focusEffective, exp, bondMinutes, masteryMinutes, rested`.
   - Session-report log on each member (optional, absent in older results; never read by the rules): `damageMoves [{move|null,count}]`, `activables [{move, attempts, activations, chanceMin/Max/Avg, limitPerSession, limitReached}]`, `passives [{source, sourceKind, effect, count}]` (passive effects that did something: per-action statMods whose `when` held, statusOnAction triggers, end/next-session heals, focus floors, encounterWeight…), `conditionLog [{type, mult, actions, forced}]`, `conditionBonusMult`.
   - `wildFactors` (optional): `localHour, weekday, league, waveSizes[], extraWild, typeWeights [{type, mult, uid, source}]` (encounterWeight and who caused it), `sync {uid, source, nature, chance} | null`, `roaming[]` (species that appeared). Shown by the UI's session report with `gen` and `Wave.activeConditionTypes`.
   - `totalPoints`, `dust`, `pokeBalls`, `energyByBlock[]` (catch energy per type per 25-min block; informational since the damage model below).
   - `waves[]` (see Encounters), `charges[]` (status / reroll), `extraWild`, `wishes`, `streak`, `roamingAfter`, `league` (league used for wave caps); `gen.rank {league, sub}` = the rung that decided the wave size and the stages (absent in older encounters = no stage restriction).
   With `rewardFactor = 0` (over 600 min today) the session is recorded but gives nothing and no waves.

3. ```ts
   applySessionResult(state, result): Result<{ state, events: ProgressEvent[] }, 'session_mismatch' | 'already_applied'>
   ```
   Idempotent per session id. Finishes any previous encounter, applies energy (`updatedAt = startedAt`), Rest/asleep flags (boxed sleepers wake up after a valid session), EXP + level ups (moves learned, cap), Bond, Mastery, dust, Poké Balls (+1 per Study Ball converted), weekly/monthly points, best league, streak, `days`, trainer EXP, history, Pokédex seen, Wishes, roaming list, and sets `state.encounter` with the waves. Clears `activeSession`. Rewarded sessions also advance missions (sessions, minutes, long sessions, distinct days, technique activations).
   `ProgressEvent`: `levelUp {uid, from, to, newMoves, slotsUnlocked}`, `evolutionAvailable {uid, to, trigger}`, `levelCapped {uid, cap}`, `trainerLevelUp`, `leagueUp {from, to, fromSub?, toSub?, dust?}` (any higher rung of the week; `dust` = rank-up Dust of the rungs climbed, already added to `state.dust`; also queued in `state.pendingLeagueNotices`).

Helpers: `captureValue(focusInputs, cfg, labelFloors?)`, `dailyRewardFactor(minutesBefore, minutes, cfg)`, `validatedMinutes`, `activationChance(baseChance, spDef, masteryMinutes, techChanceMult, cfg)`, `projectStreak`, `conditionTypes(p, at)`.

### Simulation rules (summary)
- Actions are event-driven across the team: interval = `300·60/(60+Speed)` ÷ pace mods. Each action: points `(pointsBase + SpAtk/pointsSpAtkDivisor) · condition · bond · focusEff · points mods · burst` (today `0.85·(5 + SpAtk/4)`), catch energy of a random equipped damage technique (`Atk/5 · power/60`; none → Normal at `noDamageMoveEnergyFactor`), energy cost `(0.5 + L/25) · energyCost mods`, then activables roll `min(0.4, base · techMult · mastery · techChance)` up to `limitPerSession` (and `limitPerWeek`), then passive `statusOnAction`, then heal-over-time.
- A Pokémon at 0 energy skips actions (it can act again if healed by a teammate) but still gets EXP/Bond. Members asleep from Rest do not act and do not provide team effects.
- `focusEffective` per member = capture value (`baseValue` 1.0; dev labels with its `focusLabelFloor`) × late multiplier (unless `lateClaimImmune`), then × the Grit bonus `1 + defenseFocusMaxBonus · min(1, Def / defenseFocusCap)` (`effectiveFocus`; +10 % at Def ≥ 200, so it can exceed 1), then `focusFloor`. Only points and EXP use it; dust, wave size, legendary (`legendaryChance × focus`) and shiny (`shinyChance × (0.5 + focus)`) use the session `focus`.
- EXP = `expPerMinute · minutes · focusEff · exp mods · rewardFactor`; dust = `dustPerMinute · minutes · focus · rewardFactor`; points ×`rewardFactor`; balls = round(`pokeBallsPerSession` · rewardFactor).
- Team-scope statMods and team primitives (`ballMult`, `maxFailedThrows`, `encounterWeight`, team-scope `counterMiss`) don't stack: the strongest member effect wins (lowest for `energyCost`, `counterDamageTaken`; highest chance for `counterMiss`).

### Wild damage (GDD §11.3)
Each action of a 25-min block hits **one wild of that block's wave** (classic Pokémon damage formula). Targets are drawn once the wave is rolled, with probability ∝ the wild's max HP (`capture.hitTargeting: 'maxHp'`, the team focuses the biggest threat; `'uniform'` = equal). Per hit:

```
L' = min(L_att, L_wild · levelSync.ratio + levelSync.gap)      // level sync (capture.levelSync; null = off)
A' = A · L'/L_att                                               // A = Attack (physical) or Sp. Atk (special)
D  = wild Defense (physical) or Sp. Def (special)
dmg = ((2·L'/5 + 2) · Power · A'/D / 50 + 2) · STAB(1.5 if the move type is one of the attacker's types)
      · effectiveness(type, wild types, attacker's effectivenessFloor) · capture.captureDamageScale · units
units = captureEnergy mods (targetLegendary for legendaries) · (no damage move: Normal, power 40, physical, × noDamageMoveEnergyFactor)
        · interval/interval(Speed = capture.damageReferenceSpeed)   // pace-neutral: Speed raises points, not damage/min (null = off)
```
`hpFraction = max(minHpFraction, 1 − Σdmg / maxHp)`. Hits are stored per wave in `Wave.hits: WaveHit[]` (`{ uid, target, move, type, power, damageClass, level, attack, stab, units, unitsVsLegendary, effectivenessFloors }`), so a rerolled wild takes the hits aimed at its slot. Encounters saved before this model have no `hits` and keep the legacy `computeDamage` (Σ energy · effectiveness).
Helpers: `classicDamage(L, power, A, D)`, `syncedLevel(L_att, L_wild, cfg)`, `hitDamage(hit, wildStats, wildLevel, wildTypes, legendary)`, `damageFromHits(hits, slot, wild, legendary)`, `STAB_MULT`, `NO_DAMAGE_MOVE_POWER`.

**Manual damage split** (`damage.ts`, docs/session-depth-plan.md §A). `applySessionResult` copies `PlayerState.autoDamage` (absent = false) into `EncounterState.damageMode`. `'auto'` (or absent, older saves) = the rolled `Wave.hits` as above. `'manual'`: every wave gets `assignments: {}` and `damageLocked: false`, and the wilds start at full HP. A **damage token** is one team member's hits of the block (`damageTokens(wave)`, grouped by move; ×N = Σ max(1, round(units)) per hit group). `Wave.assignments[uid]` = a wild slot (all of its hits go there) or `'auto'` (its hits keep their rolled maxHp-weighted target). Unassigned members deal nothing yet. `effectiveHits(wave)` gives the hits that actually land, and `recomputeWaveDamage` derives `damage`/`hpFraction` from them with the same formulas, so damage below `minHpFraction` is wasted (`wastedDamage(wild, cfg)`). Actions: `assignDamage(state, { waveIndex, uid, wildIndex }, rng)` (an **irreversible attack**: the wild strikes back at `uid`, see the counterattack model below), `autoAssignDamage(state, waveIndex, rng)` (every member left with Energy attacks with `'auto'`) and `setAutoDamage(state, value)`. They are allowed on the current or a later wave until it locks. Errors: `no_encounter | session_active | unknown_wave | wave_passed | damage_auto | damage_locked | unknown_token | unknown_wild | wild_resolved | already_attacked | attacker_exhausted`. `throwBall` locks the wave first (`lockWaveAttacks`: every member that has not attacked and has Energy attacks with `'auto'`, then `damageLocked: true`; auto-mode waves become all-`'auto'`), so a wave nobody touched deals the same damage as auto mode. `lockWaveDamage(wave, ctx, canAttackUid)` is the pure preview of that lock (no counterattacks). Status charges don't lock. `rerollWild` rolls the new wild with `effectiveHits`, so it inherits the slot's assigned damage. UI helpers: `estimateTokenDamage(token, wild)` (total, fraction and per-move effectiveness) and `previewAssignment(wave, uid, wildIndex)`.
Calibration (constant profile, `scripts/sim/calibrate-damage.ts`): median HP left when the wave appears ≈ 71 % in week 1, ≈ 33 % in weeks 4–12.

## Encounters and capture (`capture.ts`, `waves.ts`)

`EncounterState`: `{ sessionId, waves: Wave[], currentWave, charges: Charge[], gen, env }`.
`Wave`: `{ index, wilds: WildPokemon[], studyBall: 'available'|'used'|'lost'|'converted', contributions, activeConditionTypes }`.
`WildPokemon`: individual data (`speciesSlug, level, ivs, nature, ability, isShiny, extraMoves`) + `isLegendary, isRoaming, maxHp, damage, hpFraction (≥ 5%), status, studyBallEligible, guaranteedBall (lowest ball guaranteeing a shiny, null otherwise), failedThrows, nextThrowBonus, outcome: 'pending'|'caught'|'fled', caughtUid`.

```ts
throwBall(state, { waveIndex, wildIndex }, ball: 'study-ball' | BallSlug, rng, now)
  : Result<{ state, outcome: ThrowOutcome }, ThrowError>
```
- Only on the current wave and with no active session. Balls are consumed from the inventory; the Study Ball is one per wave, only for eligible wilds (base form, not legendary/mythical, level ≤ `studyBallMaxLevelFor(trainerLevel)` = max(`studyBallMaxLevel`, wild range min + `studyBallLevelMargin`), i.e. 20 until the range minimum passes 10) and always catches. Catches advance missions (catch, catch type T, first-throw catch, Study Ball).
- Shiny guarantee: the matching ball or better catches (`guaranteedBall`); legendaries are never guaranteed.
- Otherwise `p = min(1, (1 − 2h/3) · (R/255) · ballMult · teamBallMult · status · nextThrowBonus)`, R ≥ `legendaryMinCaptureRate` for legendaries.
- `ThrowOutcome`: `caught {uid, chance, guaranteed: 'study'|'shiny'|null}` (added to the box with full energy, +3 candies, Pokédex, roaming entry removed) · `failed {chance, counter, failedThrows, throwsLeft}` · `fled {chance, counter, roaming}` (legendaries become roaming for `roamingSessions` sessions).
- **Counterattack model** (GDD §11.4, `counter.ts`). Two triggers, one resolution (`resolveCounterOn(state, targetUid, wild, rng)`):
  - **Failed ball → the leader.** `resolveCounter(state, wild, rng)` hits `ballCounterTarget(state)` (the leader, else the next member with Energy; `null` when the whole team is at 0). The wild's status does not matter here; `counterNoFirst` (Unnerve) only spares the first failed ball.
  - **Attack → the attacker.** Assigning a damage token (`assignDamage`, `autoAssignDamage`, or the first ball via `lockWaveAttacks`) is an irreversible attack: the attacked wild strikes back at that member right away, recorded in `Wave.attacks[uid] = { wildIndex, counter, skipped }`. With the automatic split the wild that strikes back is the pending one that takes most of the token's damage (`attackTarget`). If a status technique worked on the wild (asleep or paralyzed) there is no counterattack (`wildCanStrikeBack` → `skipped: 'asleep' | 'paralyzed'`). Exhausted members (0 Energy) cannot attack (`canAttack`).
  - The attack type, damage and every target-side effect (own `counterMiss`, `counterDamageTaken`, `counterImmuneType`, `counterMinHp1`, `counterReflect`, `counterStatus`, `nextThrowBonus`, `when.isLeader`) use whoever takes the hit; team effects (team-scope `counterMiss` and `counterDamageTaken`) apply to every counter. `counterReflect` HP is kept in `WildPokemon.extraHpLoss` so later damage recomputes keep it. `counterDamage` includes `capture.counter.damageMult` (JSON 1.5; engine default 1).
- `CounterResult` (in `state.ts`): `targetUid` (who took it), `attackType` (wild type most effective vs the target), `effectiveness, damage, missed, healed, reflected, statusInflicted, survivedWith1, energyAfter`.

Other calls:
- `applyStatusCharge(state, chargeId, ref)` → sets `sleep`/`paralysis` on a pending wild of the current or a later wave.
- `rerollWild(state, chargeId, ref, rng)` → replaces the wild (it takes the hits aimed at that slot). If no eligible wild remains, the Study Ball converts to a Poké Ball.
- `advanceWave(state)` → next wave (unused Study Ball is lost; pending legendaries become roaming); after the last wave `encounter = null`. `finishEncounter(state)` skips the rest.
- `encounterModifiers(state)` → `{ ballMult, extraFailedThrows, maxFailedThrows, counterNoFirst, revealWildIvs, teamCounterDamageMult, teamCounterMiss }` for the current team (`teamCounterMiss` = best team-scope `counterMiss` chance, 0 if none; `resolveCounter` uses the max of it and the target's own `counterMiss`) (UI: show IVs when `revealWildIvs`).
- `wildCatchChance(state, wild, ball)` → probability to show before throwing.
- Pure building blocks: `captureChance`, `counterDamage`, `resolveCounter(state, wild, rng, ctx?)` (leader chain), `resolveCounterOn`, `ballCounterTarget`, `wildCanStrikeBack`, `typeEffectiveness(attack, defTypes, chart, floors?)`, `computeDamage` (legacy), `hpFractionAfter`, `waveCount`, `rollWaveSize`, `rollWild`, `speciesWeight`, `minWildLevel`, `wildLevelRange`, `isStudyBallEligible(sp, level, cfg, trainerLevel = 1)`, `studyBallMaxLevelFor(trainerLevel, cfg)`, `shinyGuaranteeBall`, `ballCovers`.
- **Wave size** (`rollWaveSize(rng, focus, rank, extraWild, cfg)`): cap = `waveSizeForRank(rank)` (`encounters.leagueWaveSize[league]` from → to over subranks 1..`leagueRampSubranks`, rounded); size = `cap − 1 ± waveSizeJitter + extraWild − (focus < lowFocusThreshold)`, clamped to `[min(minWaveSize, cap), cap]`. Caps: Base 2→4, Super 4→6, Ultra 6→7, Master 7→10 (10 from Master 5 on).
- **Stages by league** (`stageWeightsForRank`, `encounters.leagueStageWeights`): weight multiplier of 2nd and 3rd stages (0 = excluded from the pool) and of the legendary roll, from `WaveGenParams.rank`. Roaming legendaries are forced and ignore it.

## Box (`box.ts`)

All return `Result<…, BoxError>`; Pokémon in the active session are locked.
- `releasePokemon(state, uid)` → candies by stage (1/2/3); team members can't be released.
- `releaseMany(state, uids)` → releases up to `MAX_RELEASE_BATCH` (200) unique uids through `releasePokemon`, all or nothing (`empty_selection`, `too_many_selected`, `duplicate_selection`, `in_team`, `unknown_pokemon`); returns `{ state, released, candies (per chain id), totalCandies }`. `releaseCandyGain(slug)` gives the chain id and candies of one Pokémon. Saved teams keep the uid of a released member (applying the preset reports it as missing), as with `release`.
- `useCandy(state, uid, { kind: 'species' } | { kind: 'type', type }, count)` → `{ state, events, dustSpent }`. Cost `25 + 3·level` per candy at the current level; stops at the level cap (`level_cap` if none could be used).
- `equipMoves(state, uid, moves)` → validates slots (`techniqueSlots(level)`), duplicates, known (learned ∪ extra), unlocked (`move_locked` for an extra move below its unlock level) and usable.
- `setTeam(state, uids, now)` / `setLeader(state, uid, now)` → 1–6 distinct uids, only between sessions; refreshes energy first.
- `evolvePokemon(state, uid, toSlug, now, rng)` → `{ state, pokemon }` (advances `evolve` missions). Level, stone (consumed), friendship (Bond ≥ `friendshipEvolutionBond`; day = 05–18, night = otherwise). Errors: `level_too_low`, `missing_item`, `bond_too_low`, `wrong_time_of_day`, `trade_unavailable`, `unsupported`, `no_such_evolution`.
- `addItems(state, { slug: n })`, `levelProgress(p)`.

## Advanced items (`advanced.ts`, phase F4)

Pure reducers, `Result<PlayerState, AdvancedError>`; none uses an RNG. Each one: Pokémon exists (`unknown_pokemon`), is not in the active session (`session_active`), the trainer level unlocks it (`trainer_level_too_low`, `config.advanced.<kind>.minTrainerLevel`; kinds `tm`, `tera`, `mint`, `bottleCap`, `abilityCapsule`), the item is in the inventory (`no_item`), then its own rule. One use is spent.

| Reducer | Item | Unlock | Effect | Own errors |
|---|---|---|---|---|
| `useTera(state, uid, type, now)` | `tera-shard` × `advanced.tera.shardCost` (2) | `tera` (20) | `teraType = type`, `teraUntil = now + hours` (24 h), `teraSessionsLeft = sessions` (5). Again = replaces and restarts | `invalid_type`, `same_type` (the active Tera type, or the only type of a single-type species) |
| `useTm(state, uid, move)` | `technical-machine` | `tm` (15) | adds the move to `learnedMoves` (equippable at once) and `tmMoves` | `move_not_compatible` (not in `tmCandidates`), `move_already_known` |
| `useMint(state, uid, nature)` | `<nature>-mint` if owned, else `choice-mint` (the nature is picked on use; no new action) | `mint` (25) | `mintNature = nature` (picking the original nature deletes it) | `invalid_nature`, `same_nature` (same raise/lower as the current effect) |
| `useBottleCap(state, uid, stat)` | `bottle-cap` | `bottleCap` (40) | `ivs[stat] = ivMax`, `stat` added to `bottleCapped`; a higher HP IV also adds the extra max Energy to `energy.current` | `invalid_stat`, `iv_maxed` |
| `useAbilityCapsule(state, uid, ability)` | `ability-capsule` | `abilityCapsule` (30) | `ability = ability` | `no_other_ability`, `same_ability`, `invalid_ability` (hidden or not of the species) |

Queries: `unlockLevel(kind)`, `isUnlocked(state, kind)`, `activeTera(p, at)` (type or null: needs `at < teraUntil` and `teraSessionsLeft > 0`), `teraChoices(p)` (the 18 types minus the only type of a single-type species), `tmCandidates(p)` (usable moves of the species' PokeAPI `machine` learnset it cannot equip yet, sorted; a locked extra move counts, so a TM can unlock it early), `mintChoices(p)` (natures with a different effect), `mintItem(nature)` / `mintNatureOf(slug)` (null for `choice-mint`), `CHOICE_MINT`, `isMintItem(slug)`, `mintSourceFor(state, nature)` (the item `useMint` would spend: the specific mint first, else the choice mint, else null), `bottleCapStats(p)`, `abilityCapsuleChoices(p)` (defined, non-hidden, not the current one). `effectiveNature(p)` (`stats.ts`) = `mintNature ?? nature`; `computeStats` uses it, `nature` stays as caught (shown first, and Synchronize copies it).

**Tera in sessions.** `conditionTypes(p, at)` returns `[teraType]` while `activeTera(p, at)`; the session uses it at `startedAt` for each member's condition bonus and the Bug count (and the UI for its condition previews). STAB = species types ∪ active Tera type (unchanged without Tera). The move type, the defensive type against counterattacks and the team types for spawns stay the species'. `applySessionResult` spends one Tera session when the Tera was active at the session start (valid sessions only).

**Unlock gifts.** `trainerLevelRewards` adds `advanced.<kind>.unlockGift` of its item (`UNLOCK_GIFT_ITEMS`: 2 `tera-shard` at 20, 1 `ability-capsule` at 30; `bottle-cap` is in the table but `advanced.bottleCap.unlockGift` is 0) to the reward of the level that unlocks it. TMs, Mints and Bottle Caps have no gift: Bottle Caps are event-only (event drops and event mission rewards; no common mission and no level reward gives one).

**Sources** (missions, editable as live content): Tera Shards drop from missions only from trainer level 15 (`weekly-days` +1, `weekly-techniques` +1, `weekly-evolve` +2; reward tier `minTrainerLevel: 15`; Pokédex milestones, level rewards and default events give none; the unlock gift of 2 comes at 20); `weekly-long-sessions` and `weekly-catch` 1 `choice-mint` ("Choice Mint", a mission-only placeholder item with its own SVG icon) from level 25 (the Mint unlock); `weekly-catch` +1 TM from level 15 and the Pokédex 25/50 TMs from level 15 (the TM unlock); `weekly-catch-type` +1 Ability Capsule from level 30. No daily or weekly mission gives Ultra Balls (they come from level rewards every 5 levels, the Pokédex 25/50 milestones and events) and no common mission gives Bottle Caps. Economy check: `npx tsx scripts/simulate-advanced.ts` (`docs/balance-report.md` §12).

## Energy (`energy.ts`)
- `refreshEnergy(state, now)` — full refill when the local `dailyResetHour` (05:00) passed since `updatedAt`; box members regenerate `boxRecoverPctPerHour`·max per hour; team members don't regenerate. Also ends Rest sleep at the reset.
- `energyAt(state, p, now)` (pure read), `energyFraction(p)`, `isAsleepAt(state, p, now)`.
- `completeBreak(state, now)` — team +`breakRecoverPct` of max.
- `useHealItem(state, uid, item, now)` — `potion` 20, `super-potion` 50, `hyper-potion` 120, `revive` 0 → 50%.

## Leagues (`league.ts`)
`weekKey(state, now)` (local Monday `YYYY-MM-DD`), `monthKey`, `weeklyPoints`, `monthlyPoints`, `leagueForPoints(points, 'week' | 'month')`, `currentLeague(state, now)` (resets to Base every local Monday 00:00), `nextLeagueProgress`, `leagueRank`.

Subranks (GDD §14): the ladder is a list of `LadderRung {league, sub, index, points}` built from `leagues.subranks`, `weeklyThresholds` (first subrank of each league), `secondRankPoints` and `topRankPoints`, geometric inside each league and rounded to 3 significant digits (`weeklyLadderOf(cfg)`, memoized per config; `leagueLadder(period, ctx)` = ×`monthlyMultiplier` for the month). `rankForPoints`, `rankAt(index)`, `rankOf(league, sub)`, `rankInterval(index) → {from, to|null}`, `currentRank(state, now)`, `nextRankProgress(state, now) → {next, pointsNeeded, from, to, progress} | null`, `bestRank(state)`, `waveSizeForRank(rank, cfg)`, `stageWeightsForRank(rank, cfg)`, `stageWeight(stage, w)`, `currentMaxWaveSize`.

Rewards: `rankUpDust(index, cfg)` (`10 + 2·index`), `rankUpDustBetween(from, to, cfg)` (paid by `applySessionResult`), `podiumDust(index, place, cfg)`, `settlePodium(state, {weekKey, index, place, scope?, at?})` (pure, idempotent per week: pays the podium Dust, marks `league.podiumSettled` and queues a `podium` notice), `addLeagueNotice`, `podiumSettled`. `PlayerState.pendingLeagueNotices?: LeagueNotice[]` (`rankUp {weekKey, from, to, dust, at}` merged per week, `podium {weekKey, rank, place, scope, dust, at}`) is emptied by the `ackLeagueNotices` action.

## Missions (`missions.ts`, GDD §13)
Content: `data/overrides/custom-missions.json` (`ctx.missions`): `dailyCount` (3), `weeklyCount` (3), `pool[]`, `pokedex[]` milestones and `placeholderItems` (names and descriptions of mission-only items that are not in the PokeAPI data: `tera-shard` = Teralito, `technical-machine` = MT; both are used by the advanced items, see above).
- Pool entry: `{ id, period: 'daily'|'weekly' ('event' only in `EventOverlay.missions`, see «Live spawn rules and event hooks»), kind, target, minMinutes? (longSession), type? ('random' or a slug, catchType), weight, minTrainerLevel?, title, description (es/en, with {n} {minutes} {type}), rewards: tiers[] }`. A tier: `{ minTrainerLevel?, items?, dust?, typeCandies? (of the mission's type), randomItem?: { pool, count } }`; the last tier with `minTrainerLevel ≤` trainer level at generation is used (e.g. Super Balls from trainer level 5, GDD §12.7).
- Kinds: `sessions`, `studyMinutes`, `longSession` (≥ minMinutes), `studyDays` (distinct local days), `techniques` (activations), `catch`, `catchType` (species has type T; T drawn ∝ Σ captureRate of the non-legendary species of that type), `catchFirstThrow` (non-Study ball, no failed throw), `studyBall`, `evolve`. Session kinds only count rewarded sessions (valid, rewardFactor > 0).
- Rotation: daily key = local day, weekly key = local Monday; the draw (weighted, without repetition, filtered by `minTrainerLevel`) is deterministic per player (`profile.createdAt`) and period. Unclaimed missions of past periods are dropped.

```ts
missionsView(state, now): MissionsView
  // { daily: { key, endsAt, missions: MissionView[] }, weekly: { key, endsAt, missions }, pokedex: MissionView[], event: { eventId, slug, startsAt, endsAt, active, missions }[], claimable }
  // MissionView: { id, defId, eventId? (event missions), period: 'daily'|'weekly'|'event'|'pokedex', kind, title, description (texts filled in), params { n, minutes, type },
  //                progress, target, completed, claimed, reward: { items, dust, typeCandies } }
claimMission(state, missionId, now): Result<{ state, reward }, 'unknown_mission' | 'not_completed' | 'already_claimed'>
claimAllMissions(state, now): { state, rewards: { id, reward }[] }
refreshMissions(state, now)          // rotate + persist (the reducers call it themselves)
recordMissionEvent(state, event, at) // used by applySessionResult / throwBall / evolvePokemon
```
Pokédex milestones (10/25/50 species caught) are claimable once each (id `dex-10`…); their random stones are deterministic per player.

## Progression (`progression.ts`)
`expForLevel(L)` = `round(4·L^2.8)`, `levelFromExp`, `levelCap(state)` / `levelCapFor(nCaught)`, `candyDustCost(level)`, `bondBonus(minutes)`, `trainerExpForLevel`, `trainerLevelFromExp`, `trainerLevelRewards(from, to, ctx)`, `grantTrainerLevelUp(state, from, to, at, ctx)`, `gainExp(p, amount, cap)`, `applyLevel`, `evolutionOptions(state, p, now)`.

**Trainer level rewards.** `config.trainer.levelRewards = { dustBase, dustPerLevel, tiers: [{ step, <item-slug>: n, … }] }` (source `data/overrides/custom-game-config.json`; defaults: Dust `50 + 10·L`, `step 1` → 3 `poke-ball`, `step 5` → 3 `great-ball` + 1 `potion`, `step 10` → 2 `ultra-ball`; in a tier row every key but `step` is an item slug and its amount, 0 = none; editable live: `trainer.levelRewards.dustBase/dustPerLevel` and the table `trainer.levelRewards.tiers`). `trainerLevelRewards(from, to, ctx)` is pure (no RNG): the sum of levels `from+1 … to` (capped at `trainer.maxLevel`) → `{ items, dust }`, each level paying `round(dustBase + dustPerLevel·L)` Dust and the items of every tier whose `step` divides `L`. `grantTrainerLevelUp(state, from, to, at, ctx)` adds that to `inventory`/`dust` and pushes a `PendingLevelUp` (it does not touch `state.trainer`). It is called by EVERY path that raises the trainer level: `applySessionResult` (minutes of the session, also cancelled ones; the `trainerLevelUp` `ProgressEvent` now carries `items`/`dust`) and `throwBall` (EXP of a new species). The `ackLevelUp` action (`GameAction`, no payload, idempotent, always succeeds) empties `pendingLevelUps`.

## Contenido en vivo (`content.ts`, `context.ts`)
Live admin content and events (design: `docs/admin-plan.md` §1; operation: `docs/admin.md`; server side: `docs/server.md` «Live content»). The validation of patches and events lives in `src/game/content/` (not the engine): `validateContentPatch` / `validateEventOverlay`, the whitelist of editable config paths (`limits.ts`), spawn coverage (`coverage.ts`), `diffPatches` and `spawnPreview`. Layers, lowest priority first: **base** (`src/data/game/*.json`) → **admin patch** (`ContentPatch`, a full patch over the base, never a delta) → **overlays of the active events** (`EventOverlay`, applied in `(startsAt, id)` order).
- `resolveContent(patch, events, allEventItems, { hash? }) → ContextOptions`, pure. Pass the result to `createEngineContext`.
  - `patch.config` is deep-merged over the config; `species[slug].captureRate` and `moves[slug].power/accuracy` produce copies of the touched entries (the shipped data is never mutated); `techniques` / `abilities` replace by slug; `missions` sets `dailyCount`, `weeklyCount`, `pool`, `pokedex` and merges `placeholderItems`.
  - `species[slug].spawn` (`SpeciesSpawn`: `enabled`, `weightMult`, `hours` `[from,to)` windows, `weather` tags `rain|sun|snow|clear`, `minTrainerLevel`) and each event's `featured` build `ctx.spawn`: `weightMult` = admin × every featured multiplier; the other fields come from the admin only (`enabled: false` wins).
  - Events keep a closed key set (`EVENT_OVERLAY_KEYS`: `featured`, `shiny`, `legendaryChanceMult`, `drops`, `missions`, `items` plus id/slug/dates): they never change config. Shiny, legendary, drops and event missions stay on `ctx.events` and are applied by the hooks below («Live spawn rules and event hooks»).
  - `allEventItems` (items of every published event, past ones included) and the active events' `items` are added to `missions.placeholderItems`, so item names survive the event.
  - Unknown slugs or keys are ignored and reported in `ctx.warnings`. The engine never hashes: `hash` comes from the server (`'base'` when nothing changes, `'unhashed'` when something does and no hash was given).
- `EngineContext` live fields: `contentHash` (`'base'` = shipped data), `spawn: Map<slug, ResolvedSpawn>` (empty = no rules), `events: ActiveEvent[]`.
- **Golden invariant** (tested in `content.test.ts`): `resolveContent({}, [], {})` is `{}`, so its context equals `createEngineContext()` and sessions, claims and throws are bit-identical. Live rules only apply when present (no extra RNG draws, no `×1`).
- `setDefaultContext(ctx | null)`: `defaultContext()` returns the active context, or the memoized base one (`baseContext()`). Tests that set it reset it in `afterEach`. `baseContent()` returns the shipped data, techniques, abilities and missions.
- **Pinning** (`state.ts`): `ActiveSession.contentHash?` and `EncounterState.contentHash?` (absent = `'base'`). The reducer (`src/game/actions.ts`) writes `env.contentHash` on the new session at `start` (never `'base'`) and copies the session's hash to the encounter at `claim`; the engine carries it along (`{ ...enc }`). The server picks `env.ctx` per action from those hashes (`server/content/service.ts`, docs/server.md «Live content»).

### Live spawn rules and event hooks (`spawn.ts`)
The engine side of `ctx.spawn` and `ctx.events` (design: `docs/admin-plan.md` §6). Every hook returns the plain config value when there is no rule or event, so without live content sessions, claims, waves, throws, rerolls and the simulator are bit-identical (`spawn.test.ts`, «golden»).
- `spawnRuleMult(rule, { hour, weather, trainerLevel })` / `spawnMultiplier(slug, env, ctx)`: 0 if `enabled: false`, outside every `hours` window, `weather` not listed, or `trainerLevel < minTrainerLevel`; else `weightMult` (admin × featured). **Unknown hour or weather (null) rules a restricted species out.** `spawnWeatherOf(WeatherInput)` → `rain|snow|sun|clear|null`, `hourInWindow`. The content validator (`src/game/content/coverage.ts`, `preview.ts`) imports this same rule.
- Waves (`waves.ts`): `RollWildParams.env?: { localHour, weather }` (the session's, `EncounterState.env` for the reroll charge; absent = unknown). `speciesWeight` multiplies by `spawnMultiplier` only for species with a rule. Legendary roll: `legendaryChanceFor(ctx)` = `legendaryChance` × every active event's `legendaryChanceMult`; the legendary is picked uniformly, or by `spawnMultiplier` when some legendary has a rule (all ruled out → a normal wild). Shiny: `shinyChanceFor(sp, ctx)` = max(`shinyChance`, the event chances whose scope covers the species: `all`, or `featured` and featured by that event), then × (0.5 + Focus) as before. A featured species below its minimum wild level still does not appear.
- Drops: `rollEventDrops(sessionId, waves, ctx) → Record<item, n>`: per event, wave and drop (in order), `chance(perWaveChance)` until `max` **per session**, with `createRng('<sessionId>|drops|<eventId>')` (never the session RNG). `completeSession` stores them in `SessionResult.eventItems?` (absent when nothing dropped) and `applySessionResult` adds them to the inventory.
- Event missions (`missions.ts`): `MissionPeriod` gains `'event'`. `MissionsState.event?: Record<eventId, { slug, startsAt, endsAt, slots: EventMissionSlot[] }>`; slot ids `e:<eventId>:<defId>` (`eventMissionId`). `refreshMissions` adds, for each event of `ctx.events`, a slot per mission the trainer level allows (fixed list, no draw; missing ones are added later, e.g. after a level-up) and drops groups at `endsAt + EVENT_MISSION_GRACE_MS` (7 days). Each slot keeps its def's `kind`, `minMinutes`, `title` and `description` (`def`), so it is shown and claimable after the event ends; rewards and a `catchType: 'random'` type are resolved at creation (RNG `missions|<createdAt>|event|<eventId>|<defId>`). `recordMissionEvent` advances a group only while its event is in `ctx` (the session's pinned content). `missionsView(...).event`: `{ eventId, slug, startsAt, endsAt, active, missions }[]` (`MissionView.eventId`), counted in `claimable`; `claimMission` / `claimAllMissions` accept `e:` ids. Without events the state has no `event` key.
- `src/data/game/meta.json` = `{ baseHash }`: sha256 of the canonical JSON of the 10 game data files, written by `npm run build:data` (`scripts/lib/base-hash.ts`, Node only); `scripts/lib/base-hash.test.ts` checks it is up to date.

## Data / rules helpers
- Stats: `computeStats(ind)` (curves → formula), `maxEnergyOf`, `effectiveBase`, `statValue`, `actionIntervalSeconds`, `basePointsPerAction`, `catchEnergyPerAction`, `techniqueMultiplier`, `defenseFocusBonus`, `effectiveFocus`, `energyCostPerAction`, `bondMultiplier`, `masteryMultiplier`, `masteryStars`.
- Techniques: `getTechnique(slug)` → `{ kind: 'damage'|'passive'|'activable', type, power, damageClass, def } | null` (null = the move doesn't exist in PokeFocus), `isUsableMove`, `techniqueSlots(level)`, `equippableMoves(p)` (learned + unlocked extras; pass an object with `level`), `extraMoveUnlockLevel`, `unlockedExtraMoves`, `lockedExtraMoves`, `validateEquip`, `defaultEquipped` (new individuals only get unlocked moves).
- Explanations (`explain.ts`, read-only, for the help bubbles and the report): `techniqueOutlook(p, slug)` → damage (Energy per action and per 25-min wave), activable (per-action chance with its factors, expected activations per wave, limits) or passive (always/conditions, chance rolls); `abilityOutlook(p)`, `actionPace(p)`. `MemberResult.pointsStages` (running totals of the points per multiplier; absent in old results) feeds `pointsBreakdown(stages, rewardFactor, points)` → steps whose deltas add up to the points, and `sumPointsStages` for the team.
- Individuals: `createIndividual(slug, level, rng, { shiny?, nature? })`, `toOwnedPokemon(core, uid, now, ball)`, `rollIvs`, `rollAbility`, `definedAbilities`.
- Conditions: `typeConditionMult`, `pokemonConditionMult`, `activeConditionTypes`, `evaluateWhen(when, wc, cfg)`.
- Condition outlook (`activation.ts`, for the types guide and planner): `conditionOutlook(state, from, minutes, { weather? })` returns the 18 types as `{ type, mult, maxMult, active, activation }`, and `nextActivation(type, state, from, minutes, opts)` returns one `Activation`. `Activation` is data, never text: a `kind` (`always`, `window`, `weekend`, `firstOfDay`, `sameHour`, `weather`, `duration`, `chain`, `sessions`, `sound`, `team`, `noPause`, `streak`, `comeback`, `friend`) plus the numbers and the instants (epoch ms) that can be computed, such as `at` (next time it switches on) and `until` (end of the current window). Whether a type is on is always `typeConditionMult` on `conditionEnvAt`'s env, so the rules stay in one place. Like `conditionEnvAt` it assumes no pauses, no sound profile and no friend, and a start on a later day assumes nothing is studied in between. `conditionMaxMult(type, cfg)` gives the top multiplier (Poison and Bug at their cap). Time helper: `localToTs(dayKey, minuteOfDay, tz)` (a local wall-clock time to an instant, DST-aware; `startOfLocalDay` uses it).
- Effects: `passiveEffects(p)`, `teamStatMults`, `teamCaptureMods`, `selfStatMult`.
- Views: `pokemonView(state, uid, now)` → stats, current/max energy, interval, points/action (at Focus 1.0, before conditions), technique multiplier, Grit Focus bonus (`defenseFocusBonus`, 0–0.10), actions left, slots, equipped/equippable techniques with mastery stars, `lockedExtraMoves: { technique, unlockLevel }[]` and `extraMoves: { technique, unlockLevel, unlocked }[]` (for "se desbloquea al nivel X"), EXP progress, evolution options.

## Invariants
- At most one `activeSession`; `applySessionResult` is idempotent by session id; throws are refused during an active session.
- Wild `hpFraction` ≥ `capture.minHpFraction`; `Wave.hits[].target` < `wave.wilds.length`; counters never push energy below 0 (or below 1 with `counterMinHp1`).
- `team.length` 1–6, `team[0]` is the leader; `equippedMoves.length ≤ techniqueSlots(level)`; equipped/learned/extra moves are always usable moves; equipped moves are learned or unlocked extras.
- Abilities are always defined in `custom-abilities.json` (or null if the species defines none).
- Level ≤ level cap (EXP above the cap is kept and applied when the cap rises).
