/** `npm run admin:schema` output is current, and `npm run admin:validate` (the CLI and its logic) says the right things in Spanish. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ADMIN_SCHEMA_FILES, adminJsonSchemas, adminSchemaText } from '../src/game/content'
import { withLimitsBlock } from './lib/adminDocs'
import { issueTextEs, LIST_KINDS, listLines, validateText } from './lib/adminValidate'

const root = new URL('../', import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8')

describe('generated files', () => {
  for (const file of ADMIN_SCHEMA_FILES) {
    it(`docs/admin-json/${file} is up to date (run: npm run admin:schema)`, () => {
      expect(read(`docs/admin-json/${file}`)).toBe(adminSchemaText(adminJsonSchemas()[file]))
    })
  }

  it('the JSON Schemas are strict and name the format', () => {
    const s = adminJsonSchemas()
    for (const file of ADMIN_SCHEMA_FILES) {
      const schema = s[file] as { additionalProperties?: boolean; required?: string[]; properties: Record<string, { const?: string }> }
      expect(schema.additionalProperties).toBe(false)
      expect(schema.required).toContain('format')
      expect(schema.properties.format?.const).toMatch(/^pokefocus\.(event|content)@1$/)
    }
  })

  it('the table of ranges of docs/admin-json.md is up to date (run: npm run admin:schema)', () => {
    const doc = read('docs/admin-json.md')
    expect(withLimitsBlock(doc)).toBe(doc)
  })
})

const goodEvent = {
  format: 'pokefocus.event@1',
  slug: 'semana-pikachu',
  name: { es: 'Semana Pikachu', en: 'Pikachu Week' },
  description: { es: 'Texto', en: 'Text' },
  startsAt: '2026-12-01T00:00:00-05:00',
  endsAt: '2026-12-08T00:00:00-05:00',
  featured: [{ species: 'pikachu', weightMult: 3 }],
}
const NOW = Date.parse('2026-11-14T00:00:00Z')

describe('validateText (the logic of the CLI)', () => {
  it('a valid event is OK (exit 0) and summarised', () => {
    const r = validateText(JSON.stringify(goodEvent), { smoke: false, now: NOW })
    expect(r.code).toBe(0)
    expect(r.lines.join('\n')).toContain('Evento «semana-pikachu»')
    expect(r.lines.at(-1)).toMatch(/^OK/)
  })

  it('errors come with their path and in Spanish (exit 1)', () => {
    const bad = { ...goodEvent, slug: 'Semana Pikachu', startsAt: '2026-12-01', featured: [{ species: 'pikachu', weightMult: 99 }] }
    const r = validateText(JSON.stringify(bad), { smoke: false })
    expect(r.code).toBe(1)
    const text = r.lines.join('\n')
    expect(text).toContain('ERRORES (3)')
    expect(text).toContain('slug: Identificador no válido')
    expect(text).toContain('startsAt: Fecha no válida')
    expect(text).toContain('featured.0.weightMult: Demasiado grande: el máximo es 10.')
    expect(text).not.toContain('OK:')
  })

  it('semantic errors use the existing Spanish copy and show their path too', () => {
    const r = validateText(JSON.stringify({ ...goodEvent, featured: [{ species: 'nopemon', weightMult: 2 }] }), { smoke: false })
    expect(r.code).toBe(1)
    expect(r.lines.join('\n')).toContain('featured.0.species: No existe la especie en featured.0.species.')
  })

  it('warnings do not fail, and say when the tick will be needed', () => {
    const r = validateText(JSON.stringify({ ...goodEvent, featured: [{ species: 'pikachu', weightMult: 8 }] }), { smoke: false, now: NOW })
    expect(r.code).toBe(0)
    expect(r.lines.join('\n')).toContain('AVISOS (1)')
    expect(r.lines.join('\n')).toContain('casilla de confirmación')
  })

  it('a text that is not JSON, or has no known format, cannot be validated', () => {
    expect(validateText('{ nope')).toMatchObject({ code: 2 })
    expect(validateText('{ nope').lines[0]).toContain('No es JSON válido')
    const none = validateText('{}', { smoke: false })
    expect(none.code).toBe(1)
    expect(none.lines.join('\n')).toContain('format: Falta este campo.')
    expect(validateText('[]', { smoke: false }).lines.join('\n')).toContain('El JSON debe ser un objeto')
  })

  it('validates a content document and runs the smoke test by default', () => {
    const doc = { format: 'pokefocus.content@1', title: 'Ajuste', patch: { species: { eevee: { captureRate: 60 } } } }
    const r = validateText(JSON.stringify(doc))
    expect(r.code).toBe(0)
    expect(r.lines.join('\n')).toContain('prueba de humo')
    expect(validateText(JSON.stringify({ ...doc, patch: { species: { eevee: { captureRate: 0 } } } }), { smoke: false }).lines.join('\n')).toContain('patch.species.eevee.captureRate: Demasiado pequeño')
  })

  it('issueTextEs falls back to the English message for a code without copy', () => {
    expect(issueTextEs({ code: 'no_such_code', path: 'a', message: 'plain message' })).toBe('plain message')
  })
})

describe('--list', () => {
  it('lists what an assistant needs to write correct slugs', () => {
    expect(LIST_KINDS).toEqual(['species', 'items', 'moves', 'techniques', 'abilities', 'types', 'mission-kinds', 'config'])
    for (const k of LIST_KINDS) expect(listLines(k).length).toBeGreaterThan(5)
    expect(listLines('species').some((l) => l.startsWith('pikachu\t#25'))).toBe(true)
    expect(listLines('items').some((l) => l.startsWith('poke-ball\t'))).toBe(true)
    expect(listLines('config').some((l) => l.startsWith('encounters.shinyChance\tprob\t0..0.02'))).toBe(true)
    expect(listLines('mission-kinds')).toContain('longSession')
  })
})

describe('the real command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'admin-json-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const run = (args: string[]) => spawnSync('npx', ['tsx', 'scripts/admin-validate.ts', ...args], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })

  it('exits 0 for a valid file, 1 for an invalid one, 2 for a missing one; lists with --list', () => {
    const ok = join(dir, 'ok.json')
    const bad = join(dir, 'bad.json')
    writeFileSync(ok, JSON.stringify(goodEvent))
    writeFileSync(bad, JSON.stringify({ ...goodEvent, slug: 'MAL' }))
    const a = run([ok, '--no-smoke'])
    expect(a.status).toBe(0)
    expect(a.stdout).toContain('OK:')
    const b = run([bad, '--no-smoke'])
    expect(b.status).toBe(1)
    expect(b.stderr).toContain('slug: Identificador no válido')
    expect(run([join(dir, 'missing.json')]).status).toBe(2)
    expect(run([]).status).toBe(2)
    const l = run(['--list', 'types'])
    expect(l.status).toBe(0)
    expect(l.stdout).toContain('electric')
  }, 60_000)
})
