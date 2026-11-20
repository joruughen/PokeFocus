import { describe, expect, it } from 'vitest'
import { ARRIVAL_RETRY_MS, ARRIVAL_SETTLE_MS } from './TradeArrival'

describe('trade arrival window latency', () => {
  it('opens well under the old ~2.5 s once the arrival is in the game state', () => {
    expect(ARRIVAL_SETTLE_MS).toBeLessThanOrEqual(600)
    expect(ARRIVAL_SETTLE_MS + ARRIVAL_RETRY_MS).toBeLessThan(1000)
  })
})
