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

  it("surface 'skills' with a document optimizes CONTENT and writes back the shipped winner", async () => {
    // Baseline document; a scenario whose judge rewards the presence of a rule the
    // skillOpt proposer will add. A deterministic stub proposer stands in for the LLM.
    const baselineDoc = '# OR skills\n- always run a solver\n'
    let writtenBack: string | null = null
    const stubProposer = {
      kind: 'stub-skillopt',
      async propose(ctx: { currentSurface: unknown }) {
        // Prove the baseline surface is the DOCUMENT, not a refs array.
        expect(ctx.currentSurface).toBe(baselineDoc)
        return [
          {
            surface: `${baselineDoc}- recompute the objective before writing\n`,
            label: 'add-recompute-rule',
            rationale: 'stub',
          },
        ]
      },
    }
    // Judge: reward the document that contains the added rule.
    const docJudge: JudgeConfig<{ doc: string }, Scenario> = {
      name: 'doc-judge',
      dimensions: [{ key: 'q', description: 'has recompute rule' }],
      score: ({ artifact }) => {
        const has = artifact.doc.includes('recompute the objective')
        return { dimensions: { q: has ? 1 : 0 }, composite: has ? 1 : 0, notes: '' }
      },
    }
    const skillProfileWithRef = (): AgentProfile => ({
      name: 'fixture-agent',
      resources: { skills: [{ path: 'or-skills.md' } as never] },
    })

    const result = await improve(skillProfileWithRef(), [], {
      surface: 'skills',
      scenarios,
      judge: docJudge,
      agent: async (surface, _s, ctx) => {
        ctx.cost.observe(0.0001, 'stub')
        ctx.cost.observeTokens({ input: 1, output: 1 })
        return { doc: String(surface) }
      },
      generator: stubProposer as never,
      skills: {
        document: baselineDoc,
        writeBack: (winner) => {
          writtenBack = winner
        },
      },
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(typeof result.gateDecision).toBe('string')
    if (result.shipped) {
      // The winner document (content, not a refs array) was written back.
      expect(writtenBack).toContain('recompute the objective')
      // The profile ref is unchanged (writeBack owns the file, not the profile).
      expect(result.profile.resources?.skills).toEqual(skillProfileWithRef().resources?.skills)
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

  it('the default generation distiller feeds real failures to the next proposal round', async () => {
    // Judge fails scenario 'b' with a distinctive reason; everything else is perfect.
    const failingJudge: JudgeConfig<{ text: string }, Scenario> = {
      name: 'distiller-judge',
      dimensions: [{ key: 'q', description: 'fixture quality' }],
      score: ({ scenario }) =>
        scenario.id === 'b'
          ? { dimensions: { q: 0 }, composite: 0, notes: 'tour is not a permutation of 0..8' }
          : { dimensions: { q: 1 }, composite: 1, notes: 'ok' },
    }
    // Proposer stub records the findings it is handed each generation.
    const findingsSeen: unknown[][] = []
    const stubProposer = {
      kind: 'stub-recorder',
      async propose(ctx: { findings: unknown[]; populationSize: number }) {
        findingsSeen.push(ctx.findings)
        return [{ surface: `candidate-${findingsSeen.length}`, label: 'stub', rationale: 'stub' }]
      },
    }
    const result = await improve(promptProfile(), [{ seed: 'static-seed-finding' }], {
      surface: 'prompt',
      scenarios,
      judge: failingJudge,
      agent: stubAgent,
      generator: stubProposer as never,
      budget: { generations: 2, populationSize: 1, holdoutFraction: 0.25 },
    })
    expect(typeof result.gateDecision).toBe('string')
    expect(findingsSeen.length).toBeGreaterThanOrEqual(2)
    // Generation 1 proposes from the static seed; generation 2 must propose from the
    // DISTILLED failures of generation 1's cells (scenario 'b' + the judge's reason).
    expect(JSON.stringify(findingsSeen[0])).toContain('static-seed-finding')
    const secondRound = JSON.stringify(findingsSeen[1])
    expect(secondRound).toContain('"scenario":"b"')
    expect(secondRound).toContain('not a permutation')
  })

  it("surface 'code' + opts.code assembles the worktree pipeline and measures a candidate", async () => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), 'improve-code-'))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      // Byte-producer stub via the designed test seam: writes a change into the
      // candidate worktree; the driver finalizes it into a CodeSurface.
      let generatorCalls = 0
      const measured: unknown[] = []
      const result = await improve(promptProfile(), [{ finding: 'module.txt is stale' }], {
        surface: 'code',
        scenarios,
        judge,
        agent: async (surface, _scenario, ctx) => {
          ctx.cost.observe(0.0001, 'stub-agent')
          ctx.cost.observeTokens({ input: 1, output: 1 })
          measured.push(surface)
          return { text: 'ok' }
        },
        code: {
          repoRoot,
          generator: {
            kind: 'stub',
            async generate({ worktreePath }) {
              generatorCalls += 1
              writeFileSync(join(worktreePath, 'module.txt'), 'improved contents\n')
              return { applied: true, summary: 'stub improvement' }
            },
          },
        },
        budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
      })

      // The facade assembled a real proposer: the stub produced candidates, the
      // loop measured them (code surfaces reached the agent), and the gate decided.
      expect(generatorCalls).toBeGreaterThanOrEqual(1)
      expect(typeof result.gateDecision).toBe('string')
      const sawCodeSurface = measured.some(
        (m) =>
          typeof m === 'object' && m !== null && 'worktreeRef' in (m as Record<string, unknown>),
      )
      expect(sawCodeSurface).toBe(true)
      // A code winner is a worktree ref, not a profile field — profile unchanged.
      expect(result.profile.prompt?.systemPrompt).toBe('be careful')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
