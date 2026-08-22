/**
 * The generality bar from agent-runtime#969, as a test: the ENGINE's source names no node kind
 * that is not universal. A consumer extends the engine by registering, never by forking — so if
 * `integration`, `notify`, `sandbox` or `decision` ever appear in the scheduler/engine source, the
 * contract has failed, whatever else is green.
 *
 * The four core kinds live in `kinds.ts` and are allowed to name themselves; the engine and the
 * registry and the contract must not name any kind at all beyond documenting the rule.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GRAPH_DIR = join(__dirname, '..', '..', 'src', 'runtime', 'graph')
// Non-universal kinds a host registers. Any of these in engine/registry/contract source is a failure.
const HOST_KINDS = [
  'integration.invoke',
  'notify',
  'sandbox.spawn',
  'sandbox.snapshot',
  'decision',
  'wait.event',
  'wait.timer',
]

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('engine generality — the scheduler names no non-universal kind', () => {
  const files = readdirSync(GRAPH_DIR).filter((f) => f.endsWith('.ts') && f !== 'kinds.ts')
  it('has the engine files to check', () => {
    expect(files).toEqual(
      expect.arrayContaining(['engine.ts', 'kind.ts', 'registry.ts', 'index.ts']),
    )
  })
  for (const file of files) {
    it(`${file} contains no host kind id in code`, () => {
      const code = stripComments(readFileSync(join(GRAPH_DIR, file), 'utf8'))
      for (const kind of HOST_KINDS) {
        expect(code, `${file} names host kind ${JSON.stringify(kind)}`).not.toContain(`'${kind}'`)
        expect(code, `${file} names host kind ${JSON.stringify(kind)}`).not.toContain(`"${kind}"`)
      }
    })
  }
})
