import type { ImproveCost } from './improve-types'

export function copyImproveCost(cost: {
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: readonly string[]
}): ImproveCost {
  return {
    totalCostUsd: cost.totalCostUsd,
    accountingComplete: cost.accountingComplete,
    incompleteReasons: [...cost.incompleteReasons],
  }
}
