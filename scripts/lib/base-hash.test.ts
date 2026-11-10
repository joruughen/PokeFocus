import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { baseHashOfDir, canonicalJson, computeBaseHash, META_FILE, readGameDataFiles } from './base-hash.ts'

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data', 'game')

describe('canonicalJson', () => {
  it('sorts keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}')
    expect(computeBaseHash({ a: 1, b: 2 })).toBe(computeBaseHash({ b: 2, a: 1 }))
    expect(computeBaseHash({ a: 1 })).not.toBe(computeBaseHash({ a: 2 }))
  })
})

describe('src/data/game/meta.json', () => {
  it('is up to date with the game data files (run `npm run build:data`)', async () => {
    const meta = JSON.parse(await readFile(path.join(GAME_DIR, META_FILE), 'utf8')) as { baseHash: string }
    expect(meta.baseHash).toBe(await baseHashOfDir(GAME_DIR))
  })

  it('covers the 10 game data files', async () => {
    expect(Object.keys(await readGameDataFiles(GAME_DIR))).toHaveLength(10)
  })
})
