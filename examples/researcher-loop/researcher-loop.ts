/**
 * `researcherProfile` + `runLoop` + `FanoutVote` driver — the smallest
 * end-to-end researcher loop. Two parallel researcher iterations attempt
 * the same question; the validator scores citation density + namespace
 * scoping + per-item provenance; the kernel picks the highest-scoring
 * valid winner.
 *
 * Mirrors `coder-loop` in shape but plugs the `researcherProfile` preset
 * from `@tangle-network/agent-knowledge/profiles` so the entry surface is
 * `ResearchOutput` (items + citations + proposed knowledge writes) rather
 * than `CoderOutput`.
 *
 * Run with:
 *   pnpm tsx examples/researcher-loop/researcher-loop.ts
 */

import {
  type ResearchOutput,
  type ResearchTask,
  researcherProfile,
} from '@tangle-network/agent-knowledge/profiles'
import { createFanoutVoteDriver, runLoop } from '@tangle-network/agent-runtime/loops'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'

const namespace = 'example-tenant'
const task: ResearchTask = {
  question: "What is the SemVer spec's range syntax?",
  knowledgeNamespace: namespace,
  sources: ['web', 'docs'],
  maxItems: 4,
}

// ── Synthetic researcher outputs ─────────────────────────────────────────
// Two iterations: the first emits a valid ResearchOutput (per-item evidence,
// in-namespace, citation density >= floor); the second emits an item that
// leaks into a different namespace — the validator hard-fails it.
const now = Date.now()
const candidateOutputs: ResearchOutput[] = [
  {
    items: [
      {
        id: 'sv-1',
        namespace,
        claim:
          'A caret range like `^1.2.3` allows changes that do not modify the left-most non-zero element.',
        evidence: [
          {
            source: 'docs/semver-spec',
            quote: '"^1.2.3 := >=1.2.3 <2.0.0"',
            url: 'https://semver.npmjs.com/',
            capturedAt: now,
          },
        ],
        confidence: 0.92,
        authoredBy: { kind: 'agent', id: 'researcher-a' },
      },
      {
        id: 'sv-2',
        namespace,
        claim: 'A tilde range like `~1.2.3` allows patch-level changes (>=1.2.3 <1.3.0).',
        evidence: [
          {
            source: 'docs/semver-spec',
            quote: '"~1.2.3 := >=1.2.3 <1.3.0"',
            url: 'https://semver.npmjs.com/',
            capturedAt: now,
          },
        ],
        confidence: 0.95,
        authoredBy: { kind: 'agent', id: 'researcher-a' },
      },
    ],
    citations: [
      {
        url: 'https://semver.npmjs.com/',
        quote: '^1.2.3 := >=1.2.3 <2.0.0',
        confidence: 0.92,
      },
      {
        url: 'https://semver.npmjs.com/',
        quote: '~1.2.3 := >=1.2.3 <1.3.0',
        confidence: 0.95,
      },
    ],
    proposedWrites: [
      {
        kind: 'insert',
        namespace,
        item: {
          id: 'sv-1',
          namespace,
          claim:
            'A caret range like `^1.2.3` allows changes that do not modify the left-most non-zero element.',
          evidence: [
            {
              source: 'docs/semver-spec',
              quote: '"^1.2.3 := >=1.2.3 <2.0.0"',
              url: 'https://semver.npmjs.com/',
              capturedAt: now,
            },
          ],
          confidence: 0.92,
          authoredBy: { kind: 'agent', id: 'researcher-a' },
        },
      },
    ],
    notes: 'Two SemVer range operators covered; gap on hyphenated and `x` ranges.',
    gaps: ['hyphen ranges (e.g. `1.0.0 - 2.0.0`)', 'X-ranges (e.g. `1.2.x`)'],
  },
  {
    items: [
      {
        id: 'sv-leak-1',
        // Namespace mismatch — validator hard-fails this entire output.
        namespace: 'other-tenant',
        claim: 'Caret ranges restrict to compatible-version updates.',
        evidence: [
          {
            source: 'docs/semver-spec',
            url: 'https://semver.npmjs.com/',
            capturedAt: now,
          },
        ],
        confidence: 0.7,
        authoredBy: { kind: 'agent', id: 'researcher-b' },
      },
    ],
    citations: [{ url: 'https://semver.npmjs.com/', quote: 'compatible with', confidence: 0.6 }],
    proposedWrites: [],
  },
]

let dispatchIndex = 0
const sandboxClient = {
  async create(): Promise<SandboxInstance> {
    const index = dispatchIndex++
    const output = candidateOutputs[index % candidateOutputs.length]
    const id = `sandbox-researcher-${index + 1}`
    const box = {
      id,
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        yield {
          type: 'llm_call',
          data: {
            model: 'opencode/zai-coding-plan/glm-5.1',
            tokensIn: 1400,
            tokensOut: 320,
            costUsd: 0.0028,
          },
        }
        yield { type: 'result', data: { result: output } }
      },
    } as unknown as SandboxInstance
    return box
  },
}

async function main(): Promise<void> {
  const { output, validator, agentRunSpec } = researcherProfile({ task })
  const driver = createFanoutVoteDriver<ResearchTask, ResearchOutput>({ n: 2 })

  const result = await runLoop({
    driver,
    agentRun: agentRunSpec,
    output,
    validator,
    task,
    ctx: { sandboxClient },
  })

  console.log(`decision: ${result.decision}`)
  console.log(`iterations: ${result.iterations.length}`)
  console.log(`durationMs: ${result.durationMs}`)
  console.log(`totalCostUsd: ${result.costUsd.toFixed(6)}`)
  if (!result.winner) {
    console.log('no winner — every iteration failed validation')
    return
  }
  const winner = result.winner
  console.log(`winner: iteration #${winner.iterationIndex} (${winner.agentRunName})`)
  console.log(`  score: ${winner.verdict?.score?.toFixed(3)}  valid: ${winner.verdict?.valid}`)
  console.log(`  items (${winner.output.items.length}):`)
  for (const item of winner.output.items) {
    console.log(`    - [${item.namespace}] ${item.claim}`)
    for (const ev of item.evidence) {
      console.log(
        `      • ${ev.source}${ev.url ? ` (${ev.url})` : ''}${ev.quote ? `: ${ev.quote}` : ''}`,
      )
    }
  }
  console.log(`  citations: ${winner.output.citations.length}`)
  console.log(`  proposedWrites: ${winner.output.proposedWrites.length}`)
  for (const update of winner.output.proposedWrites) {
    console.log(`    - ${update.kind} into ${update.namespace}`)
  }
  if (winner.output.gaps?.length) {
    console.log(`  gaps: ${winner.output.gaps.join('; ')}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
