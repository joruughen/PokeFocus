/**
 * Natural size (px) of every animated Showdown sprite, read from the GIF headers in
 * public/sprites/showdown, into src/data/sprite-sizes.json ({ "<species id>": [width, height] }).
 * The UI sizes sprites from this table (src/ui/lib/spriteSize.ts), so a scene knows how big
 * everyone is before any image loads. Shiny sprites have the same size (checked here).
 * Run it again after `download-sprites`: npm run sprites:sizes
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const dim = (file: string): [number, number] => {
  const b = readFileSync(file)
  if (b.toString('ascii', 0, 3) !== 'GIF') throw new Error(`${file}: not a GIF`)
  return [b.readUInt16LE(6), b.readUInt16LE(8)]
}

const out: Record<string, [number, number]> = {}
const mismatched: string[] = []
for (const f of readdirSync(join(ROOT, 'public/sprites/showdown')).filter((x) => x.endsWith('.gif'))) {
  const id = f.replace('.gif', '')
  out[id] = dim(join(ROOT, 'public/sprites/showdown', f))
  try {
    const s = dim(join(ROOT, 'public/sprites/showdown-shiny', f))
    if (s[0] !== out[id][0] || s[1] !== out[id][1]) mismatched.push(id)
  } catch {
    /* no shiny sprite for this id */
  }
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => Number(a) - Number(b)))
writeFileSync(join(ROOT, 'src/data/sprite-sizes.json'), JSON.stringify(sorted) + '\n')
console.log(`${Object.keys(sorted).length} sprites → src/data/sprite-sizes.json`)
if (mismatched.length > 0) console.warn(`shiny size differs for: ${mismatched.join(', ')}`)
