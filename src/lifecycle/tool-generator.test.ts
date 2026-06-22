/**
 * The BUILDABLE-surface proof: the tool/MCP generator is a SUPERVISOR DISPATCH —
 * it fans out N parallel candidate builds, KEEPS only the verified ones, RANKS
 * the survivors by held-back marginal lift, and puts forward the single best,
 * which then flows through the SAME `runLifecycle` measure → gate → promote →
 * compose loop the prompt/skill surfaces use.
 *
 * The per-candidate build is STUBBED (no harness, no worktree, no process) so CI
 * stays cheap — the production wiring (`worktreeBuildCandidate`) is exercised by
 * its own types/build, not by spawning. What this test proves is the DISPATCH:
 * the fan-out width, the verified-only filter, the best-of-N lift rank, and the
 * end-to-end flow into the lifecycle. All deterministic.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { composeProfile } from './compose'
import { thresholdPromotionGate } from './gate'
import type { GenerateContext } from './generator'
import type { EvalResult } from './marginal-lift'
import { runLifecycle } from './run-lifecycle'
import { type BuildCandidate, type BuiltCandidate, buildableGenerator } from './tool-generator'

const baseline = (): AgentProfile => ({ name: 'agent', prompt: { systemPrompt: 'do the task' } })

// A held-back exam that rewards a profile for HAVING a specific mcp server
// mounted (the `web_search` server). A profile with it scores 1.0, without 0 —
// so the lift of a built server that lands under that key is +1.0, and a server
// that lands under any other key earns 0.
const examRewardsMcp =
  (rewardKey: string) =>
  async (profile: AgentProfile): Promise<EvalResult> => {
    const has = Boolean(profile.mcp?.[rewardKey]?.enabled)
    return { composite: has ? 1 : 0, costUsd: Object.keys(profile.mcp ?? {}).length * 0.01 }
  }

// Three candidate builds, fanned out in parallel. Only #1 and #2 verify; #1
// lands under the rewarded key (the best survivor), #2 under a useless key, #0
// failed to compile and must never be ranked.
const threeBuilds =
  (rewardKey: string): BuildCandidate =>
  async (_ctx: GenerateContext, index: number): Promise<BuiltCandidate> => {
    if (index === 0) {
      return {
        label: 'mcp-cand0',
        verified: false,
        worktreeRef: '/wt/0',
        failureReason: 'did not boot',
      }
    }
    if (index === 1) {
      return {
        label: rewardKey, // lands under the rewarded mcp key → +1.0 lift
        verified: true,
        worktreeRef: '/wt/1',
        serve: { command: 'node', args: ['server.mjs'] },
        metadata: { built: 'good' },
      }
    }
    return {
      label: 'useless-server', // verified but useless → 0 lift
      verified: true,
      worktreeRef: '/wt/2',
      serve: { command: 'node', args: ['other.mjs'] },
    }
  }

describe('buildableGenerator — tool/MCP supervisor dispatch', () => {
  it('fans out N, keeps verified, ranks by lift, and the best flows through the lifecycle', async () => {
    const base = baseline()
    const exam = examRewardsMcp('web_search')

    const result = await runLifecycle({
      baseline: base,
      domain: 'buildable-domain',
      generators: [
        buildableGenerator({
          kind: 'mcp',
          buildCandidate: threeBuilds('web_search'),
          evalRunner: exam,
          fanout: 3,
        }),
      ],
      evalRunner: exam,
      gate: thresholdPromotionGate(),
    })

    // The dispatch emitted exactly ONE artifact — the best of the verified
    // siblings — not three. The unverified build (#0) was dropped; the useless
    // verified build (#2) lost the lift rank to #1.
    expect(result.outcomes).toHaveLength(1)
    const winner = result.outcomes[0]!
    expect(winner.kind).toBe('mcp')
    expect(winner.artifact.key).toBe('web_search')

    // It won on +1.0 held-back lift and the orchestrator promoted it.
    expect(winner.scoreDelta).toBeCloseTo(1, 10)
    expect(winner.promoted).toBe(true)
    expect(result.promoted).toContain(winner.artifact.id)

    // The winning worktree ref + fan-out width rode into metadata (auditable).
    expect(winner.artifact.metadata?.worktreeRef).toBe('/wt/1')
    expect(winner.artifact.metadata?.fanout).toBe(3)
    expect(winner.artifact.metadata?.siblingScoreDelta).toBeCloseTo(1, 10)

    // The emitted mcp artifact carries the built server's stdio start command.
    const server = (
      winner.artifact.payload as { server: { command: string; args?: string[]; cwd?: string } }
    ).server
    expect(server.command).toBe('node')
    expect(server.args).toEqual(['server.mjs'])
    expect(server.cwd).toBe('/wt/1')

    // COMPOSE the promoted mcp artifact back; the composed profile beats the
    // incumbent on the same held-back exam (the built server is now mounted).
    const composed = composeProfile(result.registry, base, { kind: 'mcp' })
    expect((await exam(composed)).composite).toBe(1)
    // The base profile was never mutated.
    expect(base.mcp).toBeUndefined()
  })

  it('returns no candidate when every build fails verification', async () => {
    const allFail: BuildCandidate = async (_ctx, index) => ({
      label: `c${index}`,
      verified: false,
      worktreeRef: `/wt/${index}`,
      failureReason: 'compile error',
    })

    const result = await runLifecycle({
      baseline: baseline(),
      domain: 'buildable-domain',
      generators: [
        buildableGenerator({
          kind: 'mcp',
          buildCandidate: allFail,
          evalRunner: examRewardsMcp('web_search'),
          fanout: 4,
        }),
      ],
      evalRunner: examRewardsMcp('web_search'),
      gate: thresholdPromotionGate(),
    })

    // Nothing verified → nothing put forward → nothing promoted.
    expect(result.outcomes).toHaveLength(0)
    expect(result.promoted).toHaveLength(0)
  })

  it('builds a tool grant under the reported tool name', async () => {
    const base = baseline()
    const toolExam = async (profile: AgentProfile): Promise<EvalResult> => ({
      composite: profile.tools?.web_fetch === true ? 1 : 0,
      costUsd: 0,
    })

    const buildOneTool: BuildCandidate = async (_ctx, index) => ({
      label: `tool-cand${index}`,
      verified: true,
      worktreeRef: `/wt/${index}`,
      toolName: 'web_fetch',
    })

    const result = await runLifecycle({
      baseline: base,
      domain: 'buildable-domain',
      generators: [
        buildableGenerator({
          kind: 'tool',
          buildCandidate: buildOneTool,
          evalRunner: toolExam,
          fanout: 2,
        }),
      ],
      evalRunner: toolExam,
      gate: thresholdPromotionGate(),
    })

    expect(result.outcomes).toHaveLength(1)
    const winner = result.outcomes[0]!
    expect(winner.kind).toBe('tool')
    expect(winner.artifact.key).toBe('web_fetch')
    expect((winner.artifact.payload as { enabled: boolean }).enabled).toBe(true)
    expect(winner.promoted).toBe(true)
  })

  it('runs fanout candidates in parallel (all started before any completes)', async () => {
    let live = 0
    let maxLive = 0
    const tracking: BuildCandidate = async (_ctx, index) => {
      live++
      maxLive = Math.max(maxLive, live)
      await new Promise((r) => setTimeout(r, 5))
      live--
      return { label: `c${index}`, verified: false, worktreeRef: `/wt/${index}` }
    }

    const gen = buildableGenerator({
      kind: 'tool',
      buildCandidate: tracking,
      evalRunner: async () => ({ composite: 0, costUsd: 0 }),
      fanout: 4,
    })
    await gen.generate({ baseline: baseline(), domain: 'd', findings: [] })
    // The fan-out is concurrent: all 4 builds were in flight simultaneously.
    expect(maxLive).toBe(4)
  })

  it('throws at construction when fanout < 1 (a dispatch with no candidates)', () => {
    expect(() =>
      buildableGenerator({
        kind: 'tool',
        buildCandidate: async () => ({ label: 'x', verified: false, worktreeRef: '/x' }),
        evalRunner: async () => ({ composite: 0, costUsd: 0 }),
        fanout: 0,
      }),
    ).toThrow(/fanout must be >= 1/)
  })
})
