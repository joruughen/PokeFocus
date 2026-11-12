import { describe, expect, it } from 'vitest'
import { defaultContext } from './context'
import { studyBallMaxLevelFor } from './waves'

describe('Study Ball level limit', () => {
  const cfg = defaultContext().config
  it('starts at 9 and grows with the trainer level up to 25', () => {
    const at = (lv: number) => studyBallMaxLevelFor(lv, cfg)
    expect([at(1), at(9), at(10), at(20), at(30), at(40), at(60), at(100)]).toEqual([9, 9, 12, 17, 22, 25, 25, 25])
  })
  it('without a cap it keeps growing (older configs)', () => {
    const noCap = { ...cfg, encounters: { ...cfg.encounters, studyBallLevelCap: undefined } }
    expect(studyBallMaxLevelFor(60, noCap)).toBe(37)
  })
})
