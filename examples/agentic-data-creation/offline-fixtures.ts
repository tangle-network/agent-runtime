/**
 * The credentialless offline stand-ins for agentic-data-creation — exactly the pattern
 * examples/driver-loop and examples/self-improving-loop use: deterministic scripted workers + a
 * mocked LLM transport, so the loop runs with ZERO credentials and reproducible numbers.
 *
 * None of this is the lesson. It is the minimum that lets the lesson run offline:
 *   • a grounding DOC and two example drafts (an EASY lookup, a HARD reasoning question).
 *   • a scripted CHALLENGER: its first draft is the easy one; once it reads "too easy" in the
 *     folded prompt, it ships the hard one. (That keying is what PROVES the fold worked.)
 *   • scripted WEAK / STRONG solvers: each answers the rendered example and tags the answer with a
 *     grade marker `<<grade:strength:difficulty:sN>>` the offline judge reads.
 *   • a mock JUDGE transport bound into a real `llmJudge` `JudgeConfig`: it returns a scripted
 *     [0,1] rubric score from (strength, difficulty) with a small per-sample jitter so the N× mean
 *     is a genuine average. LIVE mode (glm-5.2) instead reads the real answer text against the rubric.
 *
 * The scores are tuned to an ILLUSTRATIVE target separation: an EASY (plain) example barely separates
 * the two solvers (gap ≈ 0.02); a HARD (agentic) one separates them widely (gap ≈ 0.31). These numbers are
 * by construction here — a live run produces the real ones.
 */

import { llmJudge } from '@tangle-network/agent-eval'
import type { JudgeConfig } from '@tangle-network/agent-eval/campaign'
import {
  inProcessSandboxClient,
  profileChatClient,
  type SandboxClient,
} from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { DataExample, SolverArtifact } from './agentic-data-creation'

// ── The grounding document + the two drafts the challenger chooses between ──────────────────

export const groundingDoc = `Idempotency in the Payments API

Every write to POST /charges may carry an Idempotency-Key header. The server stores the first
response under that key for 24 hours. A retry with the SAME key and the SAME request body replays
the stored response instead of charging again. A retry with the SAME key but a DIFFERENT body is a
conflict: the server rejects it with 422 Unprocessable Entity and creates no second charge.
Idempotency keys are scoped per merchant account.`

export const baseInstruction = (doc: string): string =>
  `You are writing ONE training example from the document below. Produce a context excerpt, a ` +
  `question answerable from it, a reference answer, and a 2-3 item rubric.\n\nDOCUMENT:\n${doc}`

// An EASY example — a direct lookup both solvers can do. (Question is a "which/what" lookup.)
const easyExample: DataExample = {
  context: 'Every write to POST /charges may carry an Idempotency-Key header.',
  question: 'Which HTTP header carries the idempotency key on a POST /charges write?',
  reference: 'The request uses an Idempotency-Key header.',
  rubric: ['Names the Idempotency-Key header', 'Ties it to a POST /charges write'],
}

// HARD examples — multi-step "why" reasoning the weak solver mostly misses. The challenger rotates
// through these so a target=N run manufactures N DISTINCT examples (not N copies of one).
const hardExamples: DataExample[] = [
  {
    context:
      'A retry with the same key but a different body is a conflict: the server rejects it with 422 ' +
      'Unprocessable Entity and creates no second charge.',
    question:
      'Why must the server reject a same-key, different-body retry with 422 instead of replaying the ' +
      'stored response, and what failure does that prevent?',
    reference:
      'Replaying the stored response would apply it to a different request; rejecting with 422 surfaces ' +
      'the mismatch and prevents a double or incorrect charge.',
    rubric: [
      'States the server rejects the retry with 422',
      'Explains replaying the stored response would be wrong for a different body',
      'Identifies the prevented failure: a double or incorrect charge',
    ],
  },
  {
    context:
      'The server stores the first response under the idempotency key for 24 hours and replays it on a ' +
      'retry with the same key and the same body.',
    question:
      'Why does replaying the stored response on a same-key, same-body retry matter, and what failure ' +
      'does it prevent when a client retries after a dropped connection?',
    reference:
      'The original request may already have charged; replaying returns that one result so a network ' +
      'retry does not create a second charge.',
    rubric: [
      'Explains the first request may have already succeeded',
      'States the stored response is replayed instead of re-charging',
      'Identifies the prevented failure: a duplicate charge on retry',
    ],
  },
  {
    context: 'Idempotency keys are scoped per merchant account.',
    question:
      'Why are idempotency keys scoped per merchant account, and what would break if they were global ' +
      'across all merchants?',
    reference:
      'Per-merchant scoping isolates key spaces; a global scope would let one merchant’s key collide ' +
      'with another’s and replay the wrong merchant’s charge.',
    rubric: [
      'States keys are isolated per merchant account',
      'Explains a global scope risks cross-merchant key collisions',
      'Identifies the failure: replaying the wrong merchant’s charge',
    ],
  },
]

// Offline difficulty signal: a "why/explain"-style question is the hard, reasoning-heavy one.
const hardQuestionPattern = /\b(why|explain|under what|what happens if|reason)\b/i

// ── The scripted challenger ─────────────────────────────────────────────────────────────────
//
// First draft (no "REJECTED" in the prompt) → the EASY example. Once the refine driver folds a
// "too easy" reject into the prompt, the challenger ships the next HARD example — proving the loop's
// behavior changed BECAUSE of the fold. Stateful so successive accepted targets get DISTINCT examples.
export function challengerClient(): SandboxClient {
  let hardServed = 0
  return inProcessSandboxClient({
    onPrompt: (prompt): SandboxEvent[] => {
      const wantsHarder = /rejected|too easy/i.test(prompt)
      const example = wantsHarder ? hardExamples[hardServed++ % hardExamples.length] : easyExample
      return [
        {
          type: 'llm_call',
          data: { model: 'offline-challenger', tokensIn: 320, tokensOut: 90, costUsd: 0.0006 },
        },
        { type: 'result', data: { result: example } },
        { type: 'done', data: { outcome: { type: 'completed' } } },
      ]
    },
  })
}

// ── The scripted solvers ────────────────────────────────────────────────────────────────────
//
// A solver answers the rendered example and tags the answer with a grade marker the offline judge
// reads. The weak solver produces a thin answer; the strong solver a complete one. The marker
// (offline only) carries strength + difficulty + the sample index for the judge's deterministic score.
export function solverClient(strength: 'weak' | 'strong'): SandboxClient {
  return inProcessSandboxClient({
    onPrompt: (prompt): SandboxEvent[] => {
      const hard = hardQuestionPattern.test(prompt)
      const sample = Number(/\[sample (\d+)\]/.exec(prompt)?.[1] ?? '0')
      const body =
        strength === 'strong'
          ? 'A complete, rubric-covering answer grounded in the context.'
          : 'A short, partial answer.'
      const answer = `${body} <<grade:${strength}:${hard ? 'hard' : 'easy'}:s${sample}>>`
      return [
        {
          type: 'llm_call',
          data: {
            model: `offline-${strength}-solver`,
            tokensIn: 140,
            tokensOut: 30,
            costUsd: 0.0003,
          },
        },
        { type: 'result', data: { result: { answer } } },
        { type: 'done', data: { outcome: { type: 'completed' } } },
      ]
    },
  })
}

// ── The rubric judge — a REAL `llmJudge` over a mocked transport ─────────────────────────────
//
// `llmJudge` builds the system+user messages, makes ONE chat() call, and parses the model's
// `{ dimensions, notes }` JSON into a canonical [0,1] `JudgeScore` (real composite math). Offline,
// the transport returns a scripted score from the answer's grade marker; live, a real model scores
// the prose. Tuned so EASY → gap ≈ 0.02, HARD → gap ≈ 0.31 (illustrative targets, by construction).
export function buildRubricJudge(): JudgeConfig<SolverArtifact> {
  const instruction =
    'Score the candidate ANSWER against the example RUBRIC. Return JSON ' +
    '{"dimensions":{"rubric_coverage":N,"correctness":N},"notes":"..."} with each score in [0,1].'
  const dimensions = [
    {
      key: 'rubric_coverage',
      description: 'fraction of the rubric criteria the answer satisfies',
    },
    { key: 'correctness', description: 'agreement with the reference answer' },
  ]
  const systemPrompt = [
    instruction,
    '',
    'Score the artifact on EACH of these dimensions:',
    ...dimensions.map(
      (dimension) => `  - "${dimension.key}": ${dimension.description} (score 0.0 to 1.0)`,
    ),
    '',
    'Respond with JSON ONLY, no prose. Every dimension is a number in [0.0 to 1.0]:',
    `{"dimensions": {${dimensions.map((dimension) => `"${dimension.key}": <number>`).join(', ')}}, "notes": "<one-line rationale>"}`,
  ].join('\n')
  const chat = profileChatClient({
    context: 'agentic-data-creation offline judge',
    profile: {
      name: 'offline-rubric-judge',
      harness: 'cli-base',
      model: {
        provider: 'scripted',
        default: 'offline-judge',
        metadata: { temperature: 0.1, maxTokens: 800 },
      },
      prompt: { systemPrompt },
    },
    executor: {
      backend: 'router',
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'injected-transport',
      complete: async (body) => {
        const messages = Array.isArray(body.messages)
          ? (body.messages as Array<Record<string, unknown>>)
          : []
        const text = messages
          .map((message) => (typeof message.content === 'string' ? message.content : ''))
          .join('\n')
        const match = /<<grade:(strong|weak):(hard|easy):s(\d+)>>/.exec(text)
        if (!match) throw new Error('offline judge: answer carried no grade marker')
        const [, strength, difficulty, sampleIndex] = match
        const base =
          difficulty === 'hard'
            ? strength === 'strong'
              ? 0.77
              : 0.46
            : strength === 'strong'
              ? 0.86
              : 0.84
        // Per-sample jitter over samples 0,1,2 → −0.02, 0, +0.02, so the N× mean lands back on `base`
        // (the variance-reduction step is a real average of distinct scores, not a no-op).
        const jitter = (Number(sampleIndex) - 1) * 0.02
        const score = Math.min(1, Math.max(0, base + jitter))
        return {
          model: 'offline-judge',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  dimensions: { rubric_coverage: score, correctness: score },
                  notes: `offline: ${strength} solver on ${difficulty} example (sample ${sampleIndex})`,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 130, completion_tokens: 25, cost: 0.0001 },
        }
      },
    },
  })

  return llmJudge<SolverArtifact>('rubric-judge', instruction, {
    chat,
    dimensions,
    scale: 'unit',
    renderUser: ({ artifact }) =>
      `RUBRIC:\n${artifact.example.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nANSWER:\n${artifact.answer}`,
  })
}
