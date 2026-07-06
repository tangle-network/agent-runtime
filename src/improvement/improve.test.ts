/**
 * `improve()` default-proposer resolution proof.
 *
 * The regression this guards: `improve()` maps each surface to a default
 * `SurfaceProposer` — `prompt → gepaProposer`, `skills → skillOptProposer`.
 * Both proposers are factories exported from `@tangle-network/agent-eval/campaign`.
 * If either import resolves to `undefined` (a substrate export drift), the facade
 * does not fail at module load — it fails at CALL time, the first time a caller
 * names that surface. So a green typecheck is not enough; this test drives the
 * REAL `improve()` far enough to construct the default proposer and run the
 * baseline-only loop to a gate decision.
 *
 * It is deterministic and offline: `gate: 'none'` forces `generations = 0`, so
 * `selfImprove` runs the baseline cells only and never calls the reflection LLM
 * the proposer wraps. The stub agent reports a token-bearing cost through
 * `ctx.cost` so the substrate's backend-integrity guard (default `'assert'`)
 * sees a real backend rather than a silent-zero stub.
 */

import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import { type ImproveSurface, improve } from './improve'

// Four scenarios so the train/holdout split is non-empty at the default 0.25
// holdout fraction (a single scenario yields an empty train split).
const scenarios: Scenario[] = [
  { id: 'a', kind: 'fixture' },
  { id: 'b', kind: 'fixture' },
  { id: 'c', kind: 'fixture' },
  { id: 'd', kind: 'fixture' },
]

// A deterministic judge — every artifact scores the same. The POINT is the
// proposer wiring, not a score gradient.
const judge: JudgeConfig<{ text: string }, Scenario> = {
  name: 'stub-judge',
  dimensions: [{ key: 'q', description: 'fixture quality' }],
  score: () => ({ dimensions: { q: 0.5 }, composite: 0.5, notes: '' }),
}

// The agent reports a token-bearing cost so the backend-integrity guard treats
// it as a real backend. Without `ctx.cost.observeTokens`, the default
// `expectUsage: 'assert'` reads the cell as a silent-zero stub and throws.
async function stubAgent(
  surface: unknown,
  _scenario: Scenario,
  ctx: DispatchContext,
): Promise<{ text: string }> {
  ctx.cost.observe(0.0001, 'stub-agent')
  ctx.cost.observeTokens({ input: 1, output: 1 })
  return { text: String(surface) }
}

const promptProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  prompt: { systemPrompt: 'be careful' },
})

const skillProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  resources: { skills: [] },
})

describe('improve() — default proposer resolution (substrate export drift guard)', () => {
  it("surface 'prompt' resolves gepaProposer and runs the baseline loop without crashing", async () => {
    const result = await improve(promptProfile(), [], {
      surface: 'prompt',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
    })

    // The default gepaProposer was constructed (not undefined) and selfImprove
    // ran to a gate decision; a baseline-only run holds.
    expect(result.gateDecision).toBe('hold')
    expect(result.shipped).toBe(false)
    // Baseline-only: nothing shipped, so the profile is returned unchanged.
    expect(result.profile.prompt?.systemPrompt).toBe('be careful')
  })

  it("surface 'skills' resolves skillOptProposer and runs the baseline loop without crashing", async () => {
    const result = await improve(skillProfile(), [], {
      surface: 'skills',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
    })

    expect(result.gateDecision).toBe('hold')
    expect(result.shipped).toBe(false)
    expect(result.profile.resources?.skills).toEqual([])
  })

  it('a real runDir makes the loop durable: provenance lands on the filesystem', async () => {
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const runDir = mkdtempSync(join(tmpdir(), 'improve-rundir-'))
    try {
      const result = await improve(promptProfile(), [], {
        surface: 'prompt',
        gate: 'none',
        scenarios,
        judge,
        agent: stubAgent,
        runDir,
      })
      expect(result.gateDecision).toBe('hold')
      // The durable-storage default keys off a real (non-mem://) runDir: the loop
      // provenance record must survive the call on disk — this is what a 5-hour
      // search recovers from after a process death.
      expect(existsSync(join(runDir, 'loop-provenance.json'))).toBe(true)
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('a surface with no zero-config default still fails loud with ConfigError', async () => {
    // The default-proposer map covers prompt + skills only; the config surfaces
    // (tools/mcp/hooks/code) require a caller-supplied generator. This is the
    // designed boundary the proposer migration must NOT erase.
    const configSurfaces: ImproveSurface[] = ['tools', 'mcp', 'hooks', 'code']
    for (const surface of configSurfaces) {
      await expect(
        improve(promptProfile(), [], { surface, gate: 'none', scenarios, judge, agent: stubAgent }),
      ).rejects.toBeInstanceOf(ConfigError)
    }
  })
})
