/**
 * PokeFocus balance simulator (GDD §20, phase F0).
 *
 *   npm run simulate                      full run (6 profiles × 20 seeds × 12 weeks, ~2–3 min)
 *   npm run simulate -- --quick           a small, fast run
 *   npm run simulate -- --config docs/balance-proposed-config.json --species docs/balance-proposed-species.json
 *
 * Flags
 *   --config file.json      game-config overrides (deep-merged over src/data/game/custom-game-config.json)
 *   --species file.json     species patches in the format of data/overrides/species.json (baseStats, captureRate)
 *   --weeks N               weeks per player (default 12)         --seeds N        players per profile (default 20)
 *   --profile a,b | all     casual, constant, marathoner, night-owl, irregular, grinder
 *   --out file.md           report (default docs/balance-report.md)
 *   --proposed file.json    proposed config (default docs/balance-proposed-config.json)
 *   --proposed-species f    proposed species patches (default docs/balance-proposed-species.json)
 *   --no-missions           never claim the engine missions (Balls, dust, stones, type candies)
 *   --no-species            skip the species-value table      --no-propose   skip the proposal and verification stages
 *   --propose-seeds N       players per profile in the proposal stages (default 10)
 *   --level-weeks N         length of the reference leveling run (default max(weeks, 16))
 *   --no-write              print the report to stdout instead of writing files
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE SIMULATED PLAYER BEHAVES (policies; "simple but not dumb")
 *
 * Only the engine's public API is used (src/engine). Time is explicit (UTC−5 fixed offset), the
 * schedule of every player is generated from (profile, seed) alone, so changing the config or the
 * policies replays exactly the same days (weather, labels, pauses, sound, claim delays).
 *
 * Flow per session: box admin → team → startSession → completeSession → applySessionResult →
 * captures wave by wave → pomodoro break (completeBreak) when the profile takes it.
 *
 * Team       Greedy by expected points of the coming session given the energy each Pokémon has left
 *            (min(actions the clock allows, actions its energy affords) × points per action, with the
 *            type condition active now, Bond and its passive modifiers). Top 6; the leader is the
 *            awake member with the highest Energía × Aguante (the one that eats the counterattacks).
 *            Sleepers (Rest) score 0 unless they are among the 4 best, in which case they take a slot
 *            so they wake up. While an escaped legendary roams, members with a status technique get
 *            +12 %. Duplicates of a species may share the team.
 * Loadout    The engine default (`defaultEquipped`), re-applied to team members before each session.
 * Study      Study Ball on the eligible wild with the most to lose with a Poké Ball (value × (1 −
 *            catch chance)); it is always used when there is an eligible wild.
 * Balls      Wilds are ranked by value (new species +40, stage, rarity, level, shiny +60,
 *            legendary +80, duplicates fade). In that order: shinies with the cheapest ball that
 *            guarantees them; legendaries with the best ball (Ultra > Great > Poké) until they flee;
 *            valuable wilds with a Great Ball while more than 2 are banked, else Poké Ball; low-value
 *            wilds only while 8+ balls are banked; stop a wild when its chance drops below 4 %.
 * Charges    Sleep before paralysis, on the unprotected wild with the largest value × (1 − catch
 *            chance), only if that is worth it (or it is the last wave). Reroll on the least valuable
 *            wild when its value is low (< 16).
 * Candies    Before each session, one candy at a time on the lowest-level member of {team + the 2 best
 *            bench Pokémon by potential at the level cap} that can take one and affords the Polvo.
 * Evolution  Everything that can evolve does (best option by potential; stones only if owned;
 *            trade evolutions are unavailable in the engine).
 * Release    Keep the 3 best (2 for evolved forms) of each species by IV quality (Rendimiento first),
 *            all shinies and legendaries; everything else is released for candies.
 * Missions   The engine missions (GDD §13, custom-missions.json): every completed daily / weekly
 *            mission and Pokédex milestone is claimed right after the session / the captures.
 * ---------------------------------------------------------------------------------------------
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deepMerge, type GameConfigOverrides } from './../src/engine/index.ts'
import { runPipeline } from './sim/pipeline.ts'
import { PROFILE_IDS, type ProfileId } from './sim/profiles.ts'
import { renderReport, setSpeciesNotes } from './sim/report.ts'
import type { SpeciesPatch } from './sim/experiments.ts'
import { progress } from './sim/util.ts'

interface Cli {
  config?: string
  species?: string
  weeks: number
  seeds: number
  profiles: ProfileId[]
  out: string
  proposed: string
  proposedSpecies: string
  missions: boolean
  speciesTable: boolean
  propose: boolean
  proposeSeeds: number
  levelWeeks?: number
  speciesWeeks: number
  write: boolean
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    weeks: 12,
    seeds: 20,
    profiles: [...PROFILE_IDS],
    out: 'docs/balance-report.md',
    proposed: 'docs/balance-proposed-config.json',
    proposedSpecies: 'docs/balance-proposed-species.json',
    missions: true,
    speciesTable: true,
    propose: true,
    proposeSeeds: 10,
    speciesWeeks: 5,
    write: true,
  }
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    switch (a) {
      case '--config': cli.config = need(i++, a); break
      case '--species': cli.species = need(i++, a); break
      case '--weeks': cli.weeks = Number(need(i++, a)); break
      case '--seeds': cli.seeds = Number(need(i++, a)); break
      case '--profile': {
        const v = need(i++, a)
        cli.profiles = v === 'all' ? [...PROFILE_IDS] : (v.split(',') as ProfileId[])
        break
      }
      case '--out': cli.out = need(i++, a); break
      case '--proposed': cli.proposed = need(i++, a); break
      case '--proposed-species': cli.proposedSpecies = need(i++, a); break
      case '--propose-seeds': cli.proposeSeeds = Number(need(i++, a)); break
      case '--level-weeks': cli.levelWeeks = Number(need(i++, a)); break
      case '--species-weeks': cli.speciesWeeks = Number(need(i++, a)); break
      case '--no-missions': cli.missions = false; break
      case '--no-species': cli.speciesTable = false; break
      case '--no-propose': cli.propose = false; break
      case '--no-write': cli.write = false; break
      case '--quick':
        cli.seeds = 3
        cli.weeks = 6
        cli.proposeSeeds = 3
        cli.speciesWeeks = 2
        break
      case '--help':
      case '-h':
        console.log('See the header of scripts/simulate.ts for the flags.')
        process.exit(0)
        break
      default:
        throw new Error(`Unknown flag ${a}`)
    }
  }
  for (const p of cli.profiles) if (!PROFILE_IDS.includes(p)) throw new Error(`Unknown profile ${p} (use ${PROFILE_IDS.join(', ')})`)
  if (!(cli.weeks >= 1 && cli.seeds >= 1)) throw new Error('--weeks and --seeds must be ≥ 1')
  return cli
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  const full = resolve(path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, JSON.stringify(value, null, 2) + '\n')
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2))
  const config = cli.config ? readJson<GameConfigOverrides>(cli.config) : undefined
  const speciesPatch = cli.species ? readJson<SpeciesPatch>(cli.species) : undefined
  // Notes the lead wrote in data/overrides/species.json, shown next to flagged species.
  const notesFile = resolve('data/overrides/species.json')
  if (existsSync(notesFile)) {
    const raw = readJson<Record<string, { _note?: string }>>(notesFile)
    setSpeciesNotes(Object.fromEntries(Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object' && v?._note).map(([k, v]) => [k, v._note as string])))
  }
  const state = { last: 0 }
  const results = runPipeline({
    seeds: cli.seeds,
    weeks: cli.weeks,
    levelWeeks: cli.levelWeeks ?? Math.max(cli.weeks, 16),
    profiles: cli.profiles,
    config,
    speciesPatch,
    missions: cli.missions,
    speciesWeeks: cli.speciesWeeks,
    propose: cli.propose,
    proposeSeeds: cli.proposeSeeds,
    species: cli.speciesTable,
    log: (m) => process.stderr.write(`\n${m}\n`),
    progress: (label, done, total) => progress(label, done, total, state),
  })
  const command = `npm run simulate${process.argv.length > 2 ? ' -- ' + process.argv.slice(2).join(' ') : ''}`
  const md = renderReport(results, command)
  if (!cli.write) {
    console.log(md)
    return
  }
  const full = resolve(cli.out)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, md)
  const proposed = { _note: 'Generado por npm run simulate. Solo las claves cambiadas respecto a src/data/game/custom-game-config.json; se usa con --config.', ...results.proposedConfig }
  writeJson(cli.proposed, proposed)
  const mergedSpecies = { _note: 'Generado por npm run simulate. Formato de data/overrides/species.json; se usa con --species.', ...deepMerge(speciesPatch ?? {}, results.proposedSpecies) }
  writeJson(cli.proposedSpecies, mergedSpecies)
  process.stderr.write(`\nInforme: ${cli.out}\nConfig propuesta: ${cli.proposed}\nEspecies propuestas: ${cli.proposedSpecies}\n${Math.round(results.seconds)} s\n`)
}

main()
