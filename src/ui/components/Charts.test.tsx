import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarChart, barGap } from './Charts'

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `d${i}`, value: i + 1 }))

describe('BarChart', () => {
  it('keeps the gaps of a 29-column chart small enough for the columns to have a width', () => {
    expect(barGap(7)).toBe('5%')
    expect(barGap(1)).toBe('0%')
    // 28 gaps may not add up to more than ~30% of the width (6% each would be 168% and leave zero-width columns).
    expect(Number.parseFloat(barGap(29)) * 28).toBeLessThanOrEqual(30.001)
  })

  it('labels only the two ends of a long series, pinned to the edges', () => {
    const html = renderToStaticMarkup(<BarChart data={points(29)} label="x" format={(v) => String(v)} />)
    expect(html).toContain('justify-between')
    expect(html).toContain('>d0<')
    expect(html).toContain('>d28<')
    expect(html).not.toContain('>d14<')
  })

  it('labels every column of a short series', () => {
    const html = renderToStaticMarkup(<BarChart data={points(7)} label="x" format={(v) => String(v)} />)
    for (let i = 0; i < 7; i++) expect(html).toContain(`>d${i}<`)
  })

  it('does not label the half line with the same number as the top one', () => {
    const html = renderToStaticMarkup(<BarChart data={[{ label: 'a', value: 1 }]} label="x" format={(v) => String(Math.round(v))} />)
    expect(html.match(/leading-none text-mist-400">1</g)).toHaveLength(1)
  })
})
