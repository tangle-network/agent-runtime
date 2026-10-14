/**
 * Platform's `selectAgentPlacement` decision table (agent-container
 * products/platform/api/tests/workflow-agent-placement.test.ts, describe
 * "selectAgentPlacement"), run against the moved `placeExecution`.
 *
 * The describe block below is copied verbatim. The adapter above it is the only new
 * code: it calls `placeExecution` with neither opt-in and translates the record back to
 * Platform's vocabulary — tier `loop` reads as `worker`, the policy as Platform's, and
 * `coveredAxes` (new in agent-placement/3) is dropped. Reasons are compared as
 * produced. Platform's schema and HTTP-journey blocks exercise Platform's own workflow
 * API and stay there.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type ExecutionTier,
  type PlacementContext,
  PlacementRefusedError,
  type PlacementRequirements,
  placeExecution,
} from '../src/placement'

const AGENT_PLACEMENT_POLICY = 'agent-placement/2'
/** Platform derives this list from its harness registry; the table reads only its first entry. */
const AGENT_RUN_HARNESSES: readonly string[] = ['claude-code', 'codex', 'opencode']
const AgentPlacementRefusedError = PlacementRefusedError
type PlatformTier = 'inference' | 'worker' | 'sandbox'
const platformTier = (tier: ExecutionTier): PlatformTier => (tier === 'loop' ? 'worker' : tier)

function selectAgentPlacement(
  cfg: PlacementRequirements,
  profile: AgentProfile | object | undefined,
  context: {
    interactive: boolean
    inferenceAvailable: boolean
    workerAvailable: boolean
    workerUnavailableReason?: string
  },
) {
  const placementContext: PlacementContext = {
    interactive: context.interactive,
    inferenceAvailable: context.inferenceAvailable,
    loopAvailable: context.workerAvailable,
    ...(context.workerUnavailableReason !== undefined
      ? { loopUnavailableReason: context.workerUnavailableReason }
      : {}),
  }
  const record = placeExecution({ requirements: cfg, profile, context: placementContext })
  return {
    chosen: platformTier(record.chosen),
    policy: AGENT_PLACEMENT_POLICY,
    reason: record.reason,
    rejected: record.rejected.map((r) => ({
      placement: platformTier(r.placement),
      reason: r.reason,
    })),
  }
}

const PROMPT_ONLY = { prompt: { systemPrompt: 'Classify the issue.' } }
const AVAILABLE = {
  interactive: false,
  inferenceAvailable: true,
  workerAvailable: true,
}
const HARNESS = AGENT_RUN_HARNESSES[0] as string
const QA_PROFILE = {
  name: 'support-qa',
  prompt: {
    systemPrompt: 'Answer billing questions.',
    instructions: ['Cite the plan name.'],
  },
  model: { default: 'deepseek/deepseek-v4.1-flash', reasoningEffort: 'low' },
}

describe('selectAgentPlacement', () => {
  it('chooses inference when no declared field needs tools, files or a session', () => {
    expect(selectAgentPlacement({}, PROMPT_ONLY, AVAILABLE)).toEqual({
      chosen: 'inference',
      policy: AGENT_PLACEMENT_POLICY,
      reason: 'no declared requirement needs tools, files or a session',
      rejected: [
        { placement: 'worker', reason: 'no declared tool needs a loop' },
        {
          placement: 'sandbox',
          reason: 'costs more and no declared requirement needs it',
        },
      ],
    })
  })

  it('chooses inference for a profile that names its model and instructions', () => {
    expect(selectAgentPlacement({}, QA_PROFILE, AVAILABLE).chosen).toBe('inference')
  })

  it.each([
    [{ connections: ['conn-slack'] }, 'connections need Hub tools'],
    [{ objects: { prefixes: ['a/'], mode: 'read' } }, 'objects need object tools'],
    [{ http: { hosts: ['api.example.com'] } }, 'http needs a fetch tool'],
  ])('chooses the worker for %o', (cfg, reason) => {
    const decision = selectAgentPlacement(cfg, QA_PROFILE, AVAILABLE)
    expect(decision.chosen).toBe('worker')
    expect(decision.reason).toContain(reason)
    expect(decision.rejected.map((r) => r.placement)).toEqual(['inference', 'sandbox'])
  })

  it.each([
    [{ harness: HARNESS }, PROMPT_ONLY, AVAILABLE, `harness ${HARNESS} is pinned`],
    [{}, { ...PROMPT_ONLY, harness: 'codex' }, AVAILABLE, 'profile harness needs a sandbox'],
    [{}, { ...PROMPT_ONLY, tools: { bash: true } }, AVAILABLE, 'profile tools bash need a sandbox'],
    [
      {},
      { ...PROMPT_ONLY, mcp: { docs: { url: 'https://m.test' } } },
      AVAILABLE,
      'profile mcp needs a sandbox',
    ],
    [
      {},
      { ...PROMPT_ONLY, resources: { files: [] } },
      AVAILABLE,
      'profile resources needs a sandbox',
    ],
    [{ source: { repo: 'o/r' } }, PROMPT_ONLY, AVAILABLE, 'source needs a sandbox'],
    [{ skills: ['sk_a'] }, PROMPT_ONLY, AVAILABLE, 'skills needs a sandbox'],
    [{ resume: true }, PROMPT_ONLY, AVAILABLE, 'resume needs a sandbox'],
    [{ maxRounds: 3 }, PROMPT_ONLY, AVAILABLE, 'maxRounds > 1'],
    [{ ask: true }, PROMPT_ONLY, AVAILABLE, 'ask needs a session'],
    [{}, PROMPT_ONLY, { ...AVAILABLE, interactive: true }, 'interactive run'],
  ])('keeps the sandbox and records why: %o %o', (cfg, profile, context, reason) => {
    const decision = selectAgentPlacement(cfg, profile, context)
    expect(decision.chosen).toBe('sandbox')
    expect(decision.reason).toContain(reason)
    expect(decision.rejected).toEqual([
      { placement: 'inference', reason: decision.reason },
      { placement: 'worker', reason: decision.reason },
    ])
  })

  it("keeps the sandbox when the action model differs from the profile's", () => {
    const decision = selectAgentPlacement({ model: 'openai/gpt-5.5' }, QA_PROFILE, AVAILABLE)
    expect(decision.chosen).toBe('sandbox')
    expect(decision.reason).toContain('differs from the profile model')
  })

  it('keeps Hub connections in the sandbox when the worker is not wired', () => {
    const decision = selectAgentPlacement({ connections: ['conn-slack'] }, PROMPT_ONLY, {
      ...AVAILABLE,
      workerAvailable: false,
    })
    expect(decision.chosen).toBe('sandbox')
  })

  it('runs a tool-free action as one worker turn when inference is not wired', () => {
    expect(
      selectAgentPlacement({}, PROMPT_ONLY, {
        ...AVAILABLE,
        inferenceAvailable: false,
      }).chosen,
    ).toBe('worker')
  })

  it('refuses a worker-only grant beside a requirement only a sandbox meets', () => {
    expect(() =>
      selectAgentPlacement(
        { objects: { prefixes: ['a/'], mode: 'read' }, harness: HARNESS },
        PROMPT_ONLY,
        AVAILABLE,
      ),
    ).toThrow(AgentPlacementRefusedError)
    expect(() =>
      selectAgentPlacement({ http: { hosts: ['a.example.com'] } }, PROMPT_ONLY, {
        ...AVAILABLE,
        workerAvailable: false,
      }),
    ).toThrow(/need the worker, but worker placement is not wired/)
  })

  it('names every blocker, not only the first', () => {
    const decision = selectAgentPlacement(
      { source: { repo: 'o/r' }, ask: true },
      { ...PROMPT_ONLY, harness: 'codex' },
      AVAILABLE,
    )
    expect(decision.reason.split('; ')).toHaveLength(3)
  })
})
