/**
 * The offline fixture for driver-loop — the worker, the output adapter, and the validator.
 *
 * It lives in this sibling so `driver-loop.ts` leads with its SUBJECT (the fold) instead of
 * 70 lines of scaffolding. None of this is the lesson; it is the deterministic stand-in that
 * lets the lesson run with zero credentials:
 *
 *   • the worker is keyed on the prompt — the FIRST draft forgets the required word (so it is
 *     rejected); any prompt that mentions the required word produces a corrected draft. That
 *     keyed behavior is what lets the example PROVE the fold worked: shot 1 only passes because
 *     the driver folded the right correction into the prompt.
 *   • the output adapter turns the raw event stream into a typed `NoteOutput`.
 *   • the validator is the pass/fail check the driver reads to decide whether to refine.
 */

import {
  type DefaultVerdict,
  inProcessSandboxClient,
  type OutputAdapter,
  type SandboxClient,
  type Validator,
} from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

// The task must draft a one-line release note that mentions the word "rollback". A real product
// would validate something richer; the required word keeps the example deterministic.
export interface NoteTask {
  feature: string
  /** The next instruction the worker should run. The DRIVER rewrites this between shots. */
  prompt: string
}
export interface NoteOutput {
  note: string
}
export const requiredWord = 'rollback'

// A worker is just something that takes a prompt and streams back events. Here we fake it via
// the `inProcessSandboxClient` primitive: the first prompt produces a draft that forgets the
// required word; any prompt that mentions it produces a corrected draft. The `onPrompt` callback
// IS the worker — no `SandboxInstance` cast (the primitive owns the one offline seam).
export function scriptedWorkerClient(): SandboxClient {
  return inProcessSandboxClient({
    onPrompt: (prompt): SandboxEvent[] => {
      // The worker "obeys" the prompt: if the driver's corrective prompt told it to mention
      // the required word, it does; otherwise it ships the naive first draft.
      const note = prompt.toLowerCase().includes(requiredWord)
        ? 'Shipped one-click restore with an instant rollback path if a deploy goes bad.'
        : 'Shipped one-click restore for failed deploys.'
      return [
        {
          type: 'llm_call',
          data: { model: 'scripted', tokensIn: 200, tokensOut: 40, costUsd: 0.0006 },
        },
        { type: 'result', data: { result: { note } satisfies NoteOutput } },
      ]
    },
  })
}

// Raw event stream → typed output.
export const output: OutputAdapter<NoteOutput> = {
  parse(events: SandboxEvent[]): NoteOutput {
    for (const ev of events) {
      if (ev.type === 'result') {
        const r = (ev as { data?: { result?: unknown } }).data?.result
        if (r && typeof r === 'object' && 'note' in r) return r as NoteOutput
      }
    }
    return { note: '' }
  },
}

// The pass/fail check the driver reads to decide whether to refine.
export const validator: Validator<NoteOutput> = {
  validate(out: NoteOutput): Promise<DefaultVerdict> {
    const valid = out.note.toLowerCase().includes(requiredWord)
    return Promise.resolve({
      valid,
      score: valid ? 1 : 0,
      notes: valid ? 'mentions rollback' : `missing required word "${requiredWord}"`,
    })
  },
}
