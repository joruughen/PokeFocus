import { describe, expect, it } from 'vitest'
import { micSkipReason, parseRecord } from './monitor'

describe('session mic record', () => {
  it('parses the current and the older (plain tally) format, drops garbage', () => {
    const tally = { silence: 10, music: 0, voice: 2, noise: 0 }
    expect(parseRecord(tally)).toEqual({ tally, issue: null })
    expect(parseRecord({ tally, issue: 'denied' })).toEqual({ tally, issue: 'denied' })
    expect(parseRecord({ tally, issue: 'weird' })).toEqual({ tally, issue: null })
    expect(parseRecord({ tally: { silence: -1 } })).toBeNull()
    expect(parseRecord('x')).toBeNull()
  })
})

describe('why the mic did not apply', () => {
  const base = { sessionId: 's1', analysedS: 7.4, profile: null, issue: null }
  it('too little analysed', () => {
    expect(micSkipReason(base)).toEqual({ kind: 'short', seconds: 7, min: 30 })
  })
  it('a problem wins over the duration', () => {
    expect(micSkipReason({ ...base, issue: 'denied' })).toEqual({ kind: 'issue', issue: 'denied' })
    expect(micSkipReason({ ...base, analysedS: 12, issue: 'lost' })).toEqual({ kind: 'issue', issue: 'lost' })
  })
  it('applied, or mic not on → nothing to explain', () => {
    expect(micSkipReason({ ...base, analysedS: 900, profile: { silence: 1, music: 0, voice: 0, noise: 0 } })).toBeNull()
    expect(micSkipReason(null)).toBeNull()
  })
})
