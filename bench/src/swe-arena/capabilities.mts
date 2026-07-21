/**
 * Substrate capability detection for the improve-loop passthroughs
 * (agent-eval branch feat/improve-loop-passthroughs).
 *
 * `runOptimization` already owns `premeasuredBaseline` and
 * `maxImprovementShots` seams, but `selfImprove` (which `improve()` fronts)
 * forwards a FIXED option list — until the passthrough branch merges, passing
 * either option through `improve()` is silently ignored. Silent ignore is the
 * worst failure mode here (a "premeasured" baseline would quietly re-run and
 * re-spend), so consumption is gated on a feature-detect:
 *
 * The probe reads the RESOLVED `@tangle-network/agent-eval/contract` module
 * text (the bundle that contains the compiled `selfImprove`) and looks for the
 * option names. Verified against the pre-branch build: the contract bundle
 * contains ZERO occurrences of either literal today (selfImprove never names
 * them; `runOptimization`'s own seam compiles into a different chunk), so the
 * probe cannot false-positive on the current substrate — and the forwarding
 * code the branch adds must name both literals in this bundle.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export interface ImproveLoopPassthroughCaps {
  /** `selfImprove` forwards `premeasuredBaseline` into the loop. */
  premeasuredBaseline: boolean
  /** `selfImprove` forwards `budget.maxImprovementShots` into the loop. */
  maxImprovementShots: boolean
}

/** Pure probe over the contract module text — unit-testable. */
export function detectPassthroughCaps(contractModuleText: string): ImproveLoopPassthroughCaps {
  return {
    premeasuredBaseline: contractModuleText.includes('premeasuredBaseline'),
    maxImprovementShots: contractModuleText.includes('maxImprovementShots'),
  }
}

/** Resolve the installed agent-eval contract bundle's file path. */
export function resolveContractModulePath(): string {
  const require = createRequire(import.meta.url)
  const url = import.meta.resolve?.('@tangle-network/agent-eval/contract')
  if (typeof url === 'string' && url.startsWith('file:')) return fileURLToPath(url)
  return require.resolve('@tangle-network/agent-eval/contract')
}

/** Feature-detect against the installed substrate. Fail-closed: an unreadable
 *  module reports no capabilities (the pin fallback stays active) and logs why. */
export function loadSubstrateCaps(log: (msg: string) => void = () => {}): ImproveLoopPassthroughCaps {
  try {
    const path = resolveContractModulePath()
    const caps = detectPassthroughCaps(readFileSync(path, 'utf8'))
    log(
      `substrate caps (${path}): premeasuredBaseline=${caps.premeasuredBaseline} maxImprovementShots=${caps.maxImprovementShots}`,
    )
    return caps
  } catch (cause) {
    log(`substrate caps probe failed — assuming no passthroughs: ${(cause as Error).message}`)
    return { premeasuredBaseline: false, maxImprovementShots: false }
  }
}
