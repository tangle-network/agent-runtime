/**
 * The offline fixture for researcher-loop — the task and a synthetic `sandboxClient` that
 * dispatches two hand-written `ResearchOutput`s.
 *
 * It lives in this sibling so `researcher-loop.ts` leads with its SUBJECT (the `runAgentRounds` +
 * inline-fanout wiring) instead of ~100 lines of fixture data. The two candidates are crafted to
 * exercise the validator's namespace firewall:
 *
 *   • iteration 0 — a VALID output: per-item evidence, in-namespace, citation density >= floor.
 *   • iteration 1 — an item that LEAKS into a different namespace; the validator hard-fails the
 *     whole output, so the kernel prunes it and the valid candidate wins.
 */

import type { ResearchOutput, ResearchTask } from '@tangle-network/agent-knowledge/profiles'
import { inProcessSandboxClient, type SandboxClient } from '@tangle-network/agent-runtime/loops'
import type { SandboxEvent } from '@tangle-network/sandbox'

export const namespace = 'example-tenant'

export const task: ResearchTask = {
  question: "What is the SemVer spec's range syntax?",
  knowledgeNamespace: namespace,
  sources: ['web', 'docs'],
  maxItems: 4,
}

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

// Each fanout dispatch picks the NEXT candidate (the inline-fanout driver issues two boxes; the
// dispatch counter is what hands iteration 0 the valid output and iteration 1 the namespace leak).
// `inProcessSandboxClient` owns the offline seam — the `onPrompt` callback IS the box, no cast.
let dispatchIndex = 0
export const sandboxClient: SandboxClient = inProcessSandboxClient({
  onPrompt: (): SandboxEvent[] => {
    const output = candidateOutputs[dispatchIndex++ % candidateOutputs.length]
    return [
      {
        type: 'llm_call',
        data: {
          model: 'opencode/zai-coding-plan/glm-5.1',
          tokensIn: 1400,
          tokensOut: 320,
          costUsd: 0.0028,
        },
      },
      { type: 'result', data: { result: output } },
    ]
  },
})
