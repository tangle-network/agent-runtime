/**
 * Substrate passthrough guard for the improve-loop options this harness
 * depends on: `selfImprove` forwarding `premeasuredBaseline` and
 * `budget.maxImprovementShots` into the loop (merged to agent-eval main).
 *
 * The remaining risk is a STALE INSTALL: the bench consumes agent-eval via a
 * pnpm `file:` dependency, which snapshots the checkout at install time — a
 * rebuilt-but-never-reinstalled substrate silently reverts to a bundle whose
 * `selfImprove` DROPS both options. Silent drop is the worst failure mode
 * here (a "premeasured" baseline would quietly re-run and re-spend; the depth
 * dial would quietly pin to the lib default), so the guard FAILS LOUD instead
 * of falling back.
 *
 * The probe reads the RESOLVED `@tangle-network/agent-eval/contract` module
 * text (the bundle that contains the compiled `selfImprove`) and requires
 * both option names. Verified against the pre-merge build: that bundle
 * contained ZERO occurrences of either literal (selfImprove never named them;
 * `runOptimization`'s own seam compiles into a different chunk), so the probe
 * cannot false-positive on a stale substrate.
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

/** Fail-loud stale-install guard: throws unless the resolved substrate names
 *  BOTH passthrough options in its contract bundle. An unreadable bundle also
 *  throws — nothing here ever downgrades to a silent fallback. */
export function assertSubstratePassthroughs(log: (msg: string) => void = () => {}): void {
  let path: string
  let caps: ImproveLoopPassthroughCaps
  try {
    path = resolveContractModulePath()
    caps = detectPassthroughCaps(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(
      'substrate passthrough probe failed — cannot prove the installed agent-eval forwards ' +
        `premeasuredBaseline/maxImprovementShots: ${(cause as Error).message}`,
      { cause },
    )
  }
  log(
    `substrate caps (${path}): premeasuredBaseline=${caps.premeasuredBaseline} maxImprovementShots=${caps.maxImprovementShots}`,
  )
  const missing = (Object.keys(caps) as Array<keyof ImproveLoopPassthroughCaps>).filter((k) => !caps[k])
  if (missing.length > 0) {
    throw new Error(
      `stale substrate install: the resolved agent-eval contract bundle (${path}) never names ` +
        `${missing.join(' + ')}, so selfImprove would silently drop the option(s). ` +
        'Rebuild the checkout (cd ~/code/agent-eval && git pull && pnpm build), then `pnpm install --force` in the bench.',
    )
  }
}
