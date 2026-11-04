// Downloads the sprites referenced by the game data into public/sprites/ so the app
// never hotlinks raw.githubusercontent.com at runtime (GDD §17, §19.0).
//   public/sprites/icons/{id}.png           box icons (gen VII)
//   public/sprites/showdown/{id}.gif        animated Showdown sprites
//   public/sprites/showdown-shiny/{id}.gif  animated shiny sprites
//   public/sprites/items/{slug}.png         item sprites
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import species from '../data/generated/species.json' with { type: 'json' }
import items from '../data/generated/items.json' with { type: 'json' }

const OUT = join(import.meta.dirname, '..', 'public', 'sprites')
const refresh = process.argv.includes('--refresh')

const jobs: Array<{ url: string; file: string }> = []
for (const s of species as Array<{ id: number; sprites: { icon: string; showdown: string; showdownShiny: string } }>) {
  jobs.push({ url: s.sprites.icon, file: join(OUT, 'icons', `${s.id}.png`) })
  jobs.push({ url: s.sprites.showdown, file: join(OUT, 'showdown', `${s.id}.gif`) })
  jobs.push({ url: s.sprites.showdownShiny, file: join(OUT, 'showdown-shiny', `${s.id}.gif`) })
}
for (const it of items as Array<{ slug: string; sprite: string }>) {
  jobs.push({ url: it.sprite, file: join(OUT, 'items', `${it.slug}.png`) })
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

const failures: string[] = []
let downloaded = 0
async function run(job: { url: string; file: string }): Promise<void> {
  if (!refresh && (await exists(job.file))) return
  const res = await fetch(job.url)
  if (!res.ok) {
    failures.push(`${res.status} ${job.url}`)
    return
  }
  await mkdir(dirname(job.file), { recursive: true })
  await writeFile(job.file, Buffer.from(await res.arrayBuffer()))
  downloaded++
}

const queue = [...jobs]
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await run(job)
  }),
)
console.log(`${jobs.length} sprites checked, ${downloaded} downloaded, ${failures.length} failed`)
for (const f of failures) console.log(`  - ${f}`)
if (failures.length) process.exit(1)
