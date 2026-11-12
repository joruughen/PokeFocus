import { describe, expect, it } from 'vitest'
import { escapeRich, parseRich, richBlocks, richMarkers, richPlainWithBullets, toggleBullets, richPlainLength, richPlainText, RICH_COLORS, RICH_MAX_DEPTH, wrapSelection, type RichNode } from './richText'

const t = (text: string): RichNode => ({ t: 'text', text })
const b = (...children: RichNode[]): RichNode => ({ t: 'bold', children })
const i = (...children: RichNode[]): RichNode => ({ t: 'italic', children })
const c = (color: (typeof RICH_COLORS)[number], ...children: RichNode[]): RichNode => ({ t: 'color', color, children })

describe('parseRich', () => {
  it('keeps plain text, newlines and empty input', () => {
    expect(parseRich('')).toEqual([])
    expect(parseRich('hola\nmundo')).toEqual([t('hola\nmundo')])
  })

  it('parses bold, italic and every colour', () => {
    expect(parseRich('a **b** c')).toEqual([t('a '), b(t('b')), t(' c')])
    expect(parseRich('a *b* c')).toEqual([t('a '), i(t('b')), t(' c')])
    for (const col of RICH_COLORS) expect(parseRich(`[${col}]x[/${col}]`)).toEqual([c(col, t('x'))])
  })

  it('nests formats', () => {
    expect(parseRich('**a *b* [red]c[/red]**')).toEqual([b(t('a '), i(t('b')), t(' '), c('red', t('c')))])
    expect(parseRich('[blue]**x**[/blue]')).toEqual([c('blue', b(t('x')))])
    expect(parseRich('[red]a [green]b[/green] c[/red]')).toEqual([c('red', t('a '), c('green', t('b')), t(' c'))])
  })

  it('reads *** as bold + italic, opening and closing', () => {
    expect(parseRich('***x***')).toEqual([b(i(t('x')))])
    expect(parseRich('**a *b***')).toEqual([b(t('a '), i(t('b')))])
    expect(parseRich('*a **b***')).toEqual([i(t('a '), b(t('b')))])
  })

  it('shows unknown tags and stray closers as literal text', () => {
    expect(parseRich('[rojo]x[/rojo]')).toEqual([t('[rojo]x[/rojo]')])
    expect(parseRich('[RED]x[/RED]')).toEqual([t('[RED]x[/RED]')])
    expect(parseRich('x[/red]')).toEqual([t('x[/red]')])
    expect(parseRich('[script]alert(1)[/script] <b>x</b>')).toEqual([t('[script]alert(1)[/script] <b>x</b>')])
  })

  it('shows an opener that is never closed as literal text, keeping the formats that did close', () => {
    expect(parseRich('**abc')).toEqual([t('**abc')])
    expect(parseRich('[red]abc **x**')).toEqual([t('[red]abc '), b(t('x'))])
    expect(parseRich('*a')).toEqual([t('*a')])
  })

  it('treats crossed nesting by closing the outer one and keeping the inner opener literal', () => {
    expect(parseRich('[red]**x[/red]')).toEqual([c('red', t('**x'))])
    expect(parseRich('**a [red]b**c[/red]')).toEqual([t('**a '), c('red', t('b**c'))])
  })

  it('does not format lone asterisks around spaces', () => {
    expect(parseRich('2 * 3 * 4')).toEqual([t('2 * 3 * 4')])
    expect(parseRich('** no **')).toEqual([t('** no **')])
    expect(parseRich('a*')).toEqual([t('a*')])
  })

  it('supports escapes', () => {
    expect(parseRich('\\*no\\* \\[red]x \\\\ \\n')).toEqual([t('*no* [red]x \\ \\n')])
    expect(parseRich(escapeRich('**x** [red]y[/red] \\'))).toEqual([t('**x** [red]y[/red] \\')])
  })

  it('caps the nesting depth: deeper openers are literal', () => {
    const deep = '[red]'.repeat(RICH_MAX_DEPTH + 3) + 'x' + '[/red]'.repeat(RICH_MAX_DEPTH + 3)
    const text = richPlainText(deep)
    expect(text).toContain('x')
    // every tag that did not fit stays visible
    expect(text.match(/\[red\]/g)?.length).toBeGreaterThan(0)
    let d = 0
    const walk = (nodes: RichNode[], n: number) => {
      d = Math.max(d, n)
      for (const x of nodes) if (x.t !== 'text') walk(x.children, n + 1)
    }
    walk(parseRich(deep), 0)
    expect(d).toBeLessThanOrEqual(RICH_MAX_DEPTH + 1)
  })

  it('never throws on hostile input and keeps every typed character somewhere', () => {
    for (const s of ['*'.repeat(500), '['.repeat(300), '\\'.repeat(301), '[red]'.repeat(100), '**[red]*[/red]**[', '*[**']) {
      expect(() => parseRich(s)).not.toThrow()
    }
    expect(richPlainText('*'.repeat(50)).length).toBeLessThanOrEqual(50)
  })
})

describe('plain text and length', () => {
  it('drops markers and resolves escapes', () => {
    expect(richPlainText('**Hola** [red]mundo[/red] *!*')).toBe('Hola mundo !')
    expect(richPlainText('\\*x\\*')).toBe('*x*')
    expect(richPlainText('[rojo]x')).toBe('[rojo]x')
  })

  it('counts the visible characters', () => {
    expect(richPlainLength('**abc**')).toBe(3)
    expect(richPlainLength('[purple]abc[/purple]')).toBe(3)
    expect(richPlainLength('abc\ndef')).toBe(7)
  })
})

describe('toolbar helpers', () => {
  it('gives the markers of each format', () => {
    expect(richMarkers('bold')).toEqual({ open: '**', close: '**' })
    expect(richMarkers('italic')).toEqual({ open: '*', close: '*' })
    expect(richMarkers('pink')).toEqual({ open: '[pink]', close: '[/pink]' })
    for (const col of RICH_COLORS) {
      const m = richMarkers(col)
      expect(parseRich(`${m.open}x${m.close}`)).toEqual([c(col, t('x'))])
    }
  })
})

describe('wrapSelection', () => {
  it('wraps the selection, keeps edge spaces outside and returns the inner selection', () => {
    expect(wrapSelection('hola mundo', 5, 10, 'bold')).toEqual({ value: 'hola **mundo**', start: 7, end: 12 })
    expect(wrapSelection('a  b  c', 1, 6, 'red')).toEqual({ value: 'a  [red]b[/red]  c', start: 8, end: 9 })
    expect(wrapSelection('abc', 3, 3, 'italic')).toEqual({ value: 'abc**', start: 4, end: 4 })
    expect(wrapSelection('abc', 9, 1, 'italic')).toEqual({ value: 'a*bc*', start: 2, end: 4 })
  })
})

describe('bullets', () => {
  it('groups runs of "- " / "• " lines into lists and keeps the rest as paragraphs', () => {
    expect(richBlocks('Intro\n- uno\n- **dos**\n• tres\nFin')).toEqual([
      { t: 'para', text: 'Intro' },
      { t: 'list', items: ['uno', '**dos**', 'tres'] },
      { t: 'para', text: 'Fin' },
    ])
    expect(richBlocks('sin lista')).toEqual([{ t: 'para', text: 'sin lista' }])
    expect(richBlocks('-sin espacio')).toEqual([{ t: 'para', text: '-sin espacio' }])
    expect(richPlainWithBullets('- [red]a[/red]\nb')).toBe('• a\nb')
  })

  it('toggleBullets adds "- " to the selected lines, or removes it when they all have it', () => {
    const v = 'uno\ndos\ntres'
    const on = toggleBullets(v, 1, 6) // selection inside "uno" .. "dos"
    expect(on.value).toBe('- uno\n- dos\ntres')
    const off = toggleBullets(on.value, on.start, on.end)
    expect(off.value).toBe(v)
    expect(toggleBullets('solo', 0, 0).value).toBe('- solo')
  })
})
