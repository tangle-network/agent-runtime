/**
 * A durable side-effect site with idempotency-key dedupe — the "external system" the conformance
 * graph commits to through its driver tool.
 *
 * Exactly-once at an external boundary is a JOINT property: the runtime re-invokes a tool whose
 * prior result it cannot prove (at-least-once invocation — unavoidable across a process kill), and
 * the effect site dedupes on a STABLE key the run re-uses after resume. This log is that site:
 *
 *   • `effects.jsonl`  — one line per COMMITTED effect (never two for one key).
 *   • `invocations.jsonl` — one line per invocation (diagnostic: shows at-least-once re-invocation
 *     and would show a run minting a DIFFERENT key for the same logical commit, which breaks
 *     idempotency and is a conformance failure).
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'

export interface SideEffectSite {
  /** The idempotent effect: commit once per key, record every invocation. */
  commit(key: string, payload: unknown): { committed: boolean; key: string }
  committedKeys(): string[]
  invocations(): Array<{ key: string; at: string }>
}

export interface SideEffectToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export const SIDE_EFFECT_TOOL_NAME = 'commit_artifact'

export function sideEffectToolSpec(): SideEffectToolSpec {
  return {
    name: SIDE_EFFECT_TOOL_NAME,
    description:
      'Commit the run artifact to the external system. Idempotent by `idempotencyKey`: the same ' +
      'key returns its prior receipt without re-committing.',
    parameters: {
      type: 'object',
      properties: {
        idempotencyKey: { type: 'string', description: 'Stable key for this logical commit.' },
        payload: { description: 'The artifact value to commit.' },
      },
      required: ['idempotencyKey', 'payload'],
      additionalProperties: false,
    },
  }
}

/** Open the durable side-effect site under `dir` (created on demand). */
export function openSideEffectSite(dir: string): SideEffectSite {
  mkdirSync(dir, { recursive: true })
  const effectsFile = `${dir}/side-effects.jsonl`
  const invocationsFile = `${dir}/side-effect-invocations.jsonl`
  const readLines = (file: string): string[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.length > 0)
      : []
  const appendLine = (file: string, line: string): void => {
    const fd = openSync(file, 'a')
    try {
      appendFileSync(fd, `${line}\n`)
    } finally {
      closeSync(fd)
    }
  }
  return {
    commit(key: string, payload: unknown) {
      const at = new Date().toISOString()
      appendLine(invocationsFile, JSON.stringify({ key, at }))
      const already = readLines(effectsFile).some(
        (l) => (JSON.parse(l) as { key: string }).key === key,
      )
      if (already) return { committed: false, key }
      appendLine(effectsFile, JSON.stringify({ key, payload, at }))
      return { committed: true, key }
    },
    committedKeys() {
      return readLines(effectsFile).map((l) => (JSON.parse(l) as { key: string }).key)
    },
    invocations() {
      return readLines(invocationsFile).map((l) => JSON.parse(l) as { key: string; at: string })
    },
  }
}
