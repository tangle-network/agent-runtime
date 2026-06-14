import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorWithValidation, type ValidationResult } from './strategy-author'

// Minimal loadable strategy modules with distinct names so the test can tell which candidate
// the validation loop returned. Same shape the evolution suite authors.
const candidateModule = (name: string) =>
  `import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('${name}', async ({ shot }) => {
  const out = await shot()
  return { score: out?.score ?? 0, resolved: false, completions: out?.completions ?? 0, progression: [out?.score ?? 0], shots: 1 }
})`

const fenced = (code: string) => `\`\`\`ts\n${code}\n\`\`\``

/** A scripted author: each chat() call pops the next reply and records the prompt it saw. */
function scriptedChat(replies: string[]) {
  const seen: string[] = []
  let i = 0
  const chat = {
    chat: async (req: { messages: Array<{ content: string }> }) => {
      seen.push(req.messages.map((m) => m.content).join('\n'))
      const reply = replies[Math.min(i, replies.length - 1)] as string
      i += 1
      return { content: reply }
    },
  }
  return { chat: chat as never, seen }
}

const baseOpts = (chat: never) => ({
  chat,
  environmentName: 'test-env',
  lossesJson: '[]',
  budget: 2,
  outDir: mkdtempSync(join(tmpdir(), 'author-val-test-')),
})

describe('authorWithValidation', () => {
  it('revises when the first candidate overfits the held-out validation slice, then returns the generalizing one', async () => {
    const { chat, seen } = scriptedChat([
      fenced(candidateModule('cand-a')),
      fenced(candidateModule('cand-b')),
    ])
    const val: Record<string, ValidationResult> = {
      'cand-a': { valScore: 0.2, trainScore: 0.9 }, // big train→val gap = overfit
      'cand-b': { valScore: 0.8, trainScore: 0.85 }, // generalizes
    }
    const result = await authorWithValidation({
      ...baseOpts(chat),
      validate: async (authored) => val[authored.strategy.name]!,
      baselineValScore: 0.5,
      rounds: 3,
    })

    expect(result.attempts).toBe(2)
    expect(result.accepted).toBe(true)
    expect(result.strategy.name).toBe('cand-b')
    expect(result.valScore).toBeCloseTo(0.8)
    expect(result.history).toEqual([
      { valScore: 0.2, trainScore: 0.9, accepted: false },
      { valScore: 0.8, trainScore: 0.85, accepted: true },
    ])
    // The SECOND author call must carry the generalization critique — and only scores + the prior
    // code, never verifier state (the firewall holds).
    expect(seen[0]).not.toContain('OVERFIT')
    expect(seen[1]).toContain('OVERFIT')
    expect(seen[1]).toContain('validation slice')
    expect(seen[1]).toContain('cand-a') // prior candidate echoed so the author revises, not restarts
  })

  it('stops at the bar — accepts the first candidate that generalizes without spending extra rounds', async () => {
    const { chat, seen } = scriptedChat([
      fenced(candidateModule('good')),
      fenced(candidateModule('unused')),
    ])
    const result = await authorWithValidation({
      ...baseOpts(chat),
      validate: async () => ({ valScore: 0.7, trainScore: 0.72 }),
      baselineValScore: 0.5,
      rounds: 3,
    })
    expect(result.attempts).toBe(1)
    expect(result.accepted).toBe(true)
    expect(result.strategy.name).toBe('good')
    expect(seen).toHaveLength(1) // no wasted revision call
  })

  it('returns the best-generalizing candidate when none clears the bar', async () => {
    const { chat } = scriptedChat([
      fenced(candidateModule('weak')),
      fenced(candidateModule('better')),
      fenced(candidateModule('weak2')),
    ])
    const val: Record<string, ValidationResult> = {
      weak: { valScore: 0.3, trainScore: 0.9 },
      better: { valScore: 0.45, trainScore: 0.9 },
      weak2: { valScore: 0.25, trainScore: 0.9 },
    }
    const result = await authorWithValidation({
      ...baseOpts(chat),
      validate: async (authored) => val[authored.strategy.name]!,
      baselineValScore: 0.5,
      rounds: 3,
    })
    expect(result.attempts).toBe(3)
    expect(result.accepted).toBe(false)
    expect(result.strategy.name).toBe('better') // best val (0.45) though below the 0.5 bar
    expect(result.valScore).toBeCloseTo(0.45)
  })

  it('gives a DUD (near-zero train) a build-it-correctly critique, not an overfit one', async () => {
    const { chat, seen } = scriptedChat([
      fenced(candidateModule('broken')),
      fenced(candidateModule('fixed')),
    ])
    const val: Record<string, ValidationResult> = {
      broken: { valScore: 0.0, trainScore: 0.05 }, // DUD: ~0 on train = shots failing, NOT overfit
      fixed: { valScore: 0.7, trainScore: 0.72 },
    }
    const result = await authorWithValidation({
      ...baseOpts(chat),
      validate: async (authored) => val[authored.strategy.name]!,
      baselineValScore: 0.5,
      rounds: 3,
    })
    expect(result.strategy.name).toBe('fixed')
    expect(seen[1]).toContain('DID NOT WORK') // dud branch fired
    expect(seen[1]).not.toContain('OVERFIT') // NOT the overfit critique
    expect(seen[1]).toContain('listTools') // actionable cause (the common dud root)
  })

  it('recovers when an attempt throws (no code block / failed compile) instead of crashing', async () => {
    const { chat, seen } = scriptedChat([
      'no code block here at all',
      fenced(candidateModule('recovered')),
    ])
    const result = await authorWithValidation({
      ...baseOpts(chat),
      validate: async () => ({ valScore: 0.8, trainScore: 0.8 }),
      baselineValScore: 0.5,
      rounds: 3,
    })
    expect(result.attempts).toBe(2) // first threw (no fence), second succeeded
    expect(result.strategy.name).toBe('recovered')
    expect(result.accepted).toBe(true)
    expect(seen[1]).toContain('failed to compile/load') // the recovery critique
  })
})
