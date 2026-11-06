/**
 * A `ghost` Button sets its own text color (`text-mist-100`). A `text-ink` /
 * `text-dusk-*` class passed next to it loses to that rule (same specificity, the
 * stylesheet order decides), so the label stays near-white: on a light surface
 * it is invisible (the Box release button was exactly that). Pick another
 * variant, or wrap the label, instead of overriding the color.
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

describe('Button colors', () => {
  it('no ghost Button tries to override its text color with a dark class', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const [file, src] of Object.entries(sources)) {
      // Each <Button …> / <IconButton …> opening tag. It may span lines and hold arrow functions (`=>`).
      for (const m of src.matchAll(/<(?:Icon)?Button\b(?:=>|[^>])*>/g)) {
        const tag = m[0]
        if (/variant="ghost"/.test(tag) && /className=(?:"[^"]*|\{[^}]*)\btext-(?:ink|dusk-\d+)\b/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
