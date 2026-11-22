/** Trainer-sprite tooling: the index parser, the catalogue builder and the downloaded sprites. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import catalog from '../src/game/trainerCatalog.json'
import { TRAINER_CORE } from '../src/game/trainers'
import { buildCatalog, catalogSlugs, parseIndex, type TrainerCatalogData } from './lib/trainersIndex'

const HTML = `
<figure id="acetrainer.png"><img src="acetrainer.png" /><figcaption><a href="acetrainer.png">acetrainer</a></figcaption></figure>
<figure id="acetrainerf.png"><img src="acetrainerf.png" /><figcaption><a href="acetrainerf.png">acetrainerf</a></figcaption></figure>
<figure id="acetrainer-gen3rs.png"><img src="x" /><figcaption><a href="x">acetrainer-gen3rs</a></figcaption></figure>
<figure id="aarune.png"><img src="x" /><figcaption><a href="x">aarune</a><br />by kyledove</figcaption></figure>
<figure id="evil.png"><img src="x" /><figcaption><a href="x">evil</a><br />by ev\`il|name</figcaption></figure>
<figure id="../bad.png"><img src="x" /><figcaption><a href="x">bad</a></figcaption></figure>
<figure id="zed.png"><img src="x" /><figcaption><a href="x">zed</a><br />by A &amp; B</figcaption></figure>
<figure id="bee.png"><img src="x" /><figcaption><a href="x">bee</a><br />by kyledove</figcaption></figure>
`

describe('trainer index', () => {
  it('parses slugs and credits, drops unsafe slugs, cleans credits', () => {
    const idx = parseIndex(HTML)
    expect(idx.map((t) => t.slug)).toEqual(['aarune', 'acetrainer', 'acetrainer-gen3rs', 'acetrainerf', 'bee', 'evil', 'zed'])
    expect(idx.find((t) => t.slug === 'aarune')?.credit).toBe('kyledove')
    expect(idx.find((t) => t.slug === 'zed')?.credit).toBe('A & B')
    expect(idx.find((t) => t.slug === 'acetrainer')?.credit).toBe('')
    expect(idx.find((t) => t.slug === 'evil')?.credit).toBe('evilname')
  })

  it('builds the catalogue: uncredited sprites, and fan art by author (biggest first, all sorted)', () => {
    const c = buildCatalog(parseIndex(HTML))
    expect(c.classic).toEqual(['acetrainer', 'acetrainer-gen3rs', 'acetrainerf'])
    expect(Object.keys(c.fan)).toEqual(['kyledove', 'A & B', 'evilname'])
    expect(c.fan.kyledove).toEqual(['aarune', 'bee'])
    expect(catalogSlugs(c).sort()).toEqual(parseIndex(HTML).map((t) => t.slug).sort())
  })
})

describe('src/game/trainerCatalog.json', () => {
  const data = catalog as TrainerCatalogData
  const slugs = catalogSlugs(data)
  it('has the whole catalogue, once each, and every featured sprite', () => {
    expect(slugs.length).toBeGreaterThanOrEqual(1500)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of TRAINER_CORE) expect(slugs, s).toContain(s)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })

  it('every sprite is downloaded as an 80×80 PNG, and nothing else is in the folder', () => {
    const dir = join(import.meta.dirname, '..', 'public', 'sprites', 'trainers')
    const files = readdirSync(dir).sort()
    expect(files).toEqual(slugs.map((s) => `${s}.png`).sort())
    for (const f of files) {
      const png = readFileSync(join(dir, f))
      expect(png.subarray(1, 4).toString('ascii'), f).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], f).toEqual([80, 80])
    }
  })
})
