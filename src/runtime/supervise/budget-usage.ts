import { addTokenUsage, zeroTokenUsage } from '../util'
import type { LoopTokenUsage, Spend, UsageEvent } from './types'

/** Fold normalized usage events into the spend shape consumed by the budget pool. */
export function spendFromUsageEvents(events: UsageEvent[]): Spend {
  const tokens = zeroTokenUsage()
  let usd = 0
  let usdKnown = true
  let iterations = 0
  for (const event of events) {
    if (event.kind === 'tokens') {
      addTokenUsage(tokens, { input: event.input, output: event.output })
    } else if (event.kind === 'cost') {
      usd += event.usd
      if (event.usdKnown === false) usdKnown = false
    } else if (event.kind === 'iteration') {
      iterations += 1
    }
  }
  return {
    iterations,
    tokens,
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

export async function foldUsage(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend> {
  if (Array.isArray(events)) return spendFromUsageEvents(events)
  const tokens = zeroTokenUsage()
  let usd = 0
  let usdKnown = true
  let iterations = 0
  for await (const event of events) {
    if (event.kind === 'tokens') {
      addTokenUsage(tokens, { input: event.input, output: event.output })
    } else if (event.kind === 'cost') {
      usd += event.usd
      if (event.usdKnown === false) usdKnown = false
    } else if (event.kind === 'iteration') {
      iterations += 1
    }
  }
  return {
    iterations,
    tokens,
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

export function totalTokens(usage: LoopTokenUsage): number {
  return usage.input + usage.output
}
