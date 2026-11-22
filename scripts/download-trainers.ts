// Trainer sprites of the profile and the study-group scenes (GDD §9.2): the whole Pokémon Showdown catalogue.
//   npm run download:trainers                downloads every sprite of src/game/trainerCatalog.json into
//                                            public/sprites/trainers/<slug>.png (skips the ones already there)
//   npm run download:trainers -- --refresh   downloads them all again
//   npm run download:trainers -- --update    first reads Showdown's index and rewrites trainerCatalog.json
//                                            (new sprites appear; ones Showdown dropped are reported and leave the
//                                            catalogue, their PNGs are not deleted)
// Like scripts/download-sprites.ts, the app never hotlinks Showdown at runtime.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { buildCatalog, catalogSlugs, parseIndex, TRAINERS_BASE, type TrainerCatalogData } from './lib/trainersIndex'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'public', 'sprites', 'trainers')
const CATALOG = join(ROOT, 'src', 'game', 'trainerCatalog.json')
const refresh = process.argv.includes('--refresh')
const update = process.argv.includes('--update')

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** A real 80×80 PNG: what lands in public/ is checked, not trusted (TrainerSprite draws it at 80 × scale). */
function checkPng(buf: Buffer): string | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return 'not a PNG'
  if (buf.length > 64 * 1024) return 'too big'
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return w === 80 && h === 80 ? null : `size ${w}×${h}, expected 80×80`
}

async function updateCatalog(): Promise<void> {
  const res = await fetch(TRAINERS_BASE)
  if (!res.ok) throw new Error(`index: HTTP ${res.status}`)
  const index = parseIndex(await res.text())
  if (index.length < 1000) throw new Error(`index: only ${index.length} sprites parsed, the page format may have changed`)
  const next = buildCatalog(index)
  const had = new Set(catalogSlugs(JSON.parse(await readFile(CATALOG, 'utf8')) as TrainerCatalogData))
  const now = new Set(catalogSlugs(next))
  const added = [...now].filter((s) => !had.has(s))
  const gone = [...had].filter((s) => !now.has(s))
  await writeFile(CATALOG, JSON.stringify(next, null, 1) + '\n')
  console.log(`catalog: ${now.size} sprites, ${added.length} new${added.length ? ` (${added.slice(0, 12).join(', ')}${added.length > 12 ? '…' : ''})` : ''}, ${gone.length} no longer on Showdown`)
  if (gone.length) console.log(`  gone: ${gone.join(', ')} (a player who chose one falls back to their default; their PNG stays in public/)`)
}

async function download(): Promise<void> {
  const slugs = catalogSlugs(JSON.parse(await readFile(CATALOG, 'utf8')) as TrainerCatalogData)
  await mkdir(OUT, { recursive: true })
  const failures: string[] = []
  let downloaded = 0
  const queue = [...slugs]
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let slug = queue.shift(); slug; slug = queue.shift()) {
        const file = join(OUT, `${slug}.png`)
        if (!refresh && (await exists(file))) continue
        const res = await fetch(`${TRAINERS_BASE}${slug}.png`)
        if (!res.ok) {
          failures.push(`${res.status} ${slug}`)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        const bad = checkPng(buf)
        if (bad) {
          failures.push(`${slug}: ${bad}`)
          continue
        }
        await writeFile(file, buf)
        downloaded++
      }
    }),
  )
  console.log(`${slugs.length} trainer sprites checked, ${downloaded} downloaded, ${failures.length} failed`)
  for (const f of failures) console.log(`  - ${f}`)
  if (failures.length) process.exit(1)
}

if (update) await updateCatalog()
await download()
