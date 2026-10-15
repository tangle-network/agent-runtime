/**
 * The deduplication audit: no two graph examples share a topology.
 *
 * `structuralSignature` (examples/graphs/catalog.ts) reduces each example's graph to node count by
 * role, the root's tool grants, model families, every edge's kind, cap and continuity, and where
 * each analyst sits and reports. This test fails when
 *
 *   1. two catalogued examples share a signature (a new example repeating an old shape),
 *   2. a file in examples/graphs is neither catalogued nor named as not-a-graph (a new example
 *      dodging the audit),
 *   3. the README catalog omits a catalogued example, or
 *   4. the signature itself stops telling shapes apart (its own controls).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bestOfN } from '../../examples/graphs/best-of-n'
import {
  catalog,
  exampleSignature,
  NOT_GRAPH_FILES,
  structuralSignature,
} from '../../examples/graphs/catalog'
import { shotLoop } from '../../examples/graphs/shot-loop'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../examples/graphs')

describe('examples/graphs — structural deduplication audit', () => {
  it('no two examples share a structural signature', () => {
    const owners = new Map<string, string[]>()
    for (const entry of catalog) {
      const sig = exampleSignature(entry)
      owners.set(sig, [...(owners.get(sig) ?? []), entry.file])
    }
    const repeated = [...owners.values()].filter((files) => files.length > 1)
    expect(repeated, `examples sharing a topology: ${JSON.stringify(repeated)}`).toEqual([])
  })

  it('every file in examples/graphs is catalogued or named as not a graph', () => {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.slice(0, -'.ts'.length))
    const known = new Set([...catalog.map((entry) => entry.file), ...Object.keys(NOT_GRAPH_FILES)])
    expect(files.filter((file) => !known.has(file))).toEqual([])
    expect([...known].filter((file) => !files.includes(file))).toEqual([])
  })

  it('the README catalog names every catalogued example', () => {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    expect(
      catalog.filter((entry) => !readme.includes(`${entry.file}.ts`)).map((e) => e.file),
    ).toEqual([])
  })

  it('the signature ignores wording but sees a changed cap, edge, or analyst', () => {
    const base = bestOfN().graph
    const reworded = {
      ...base,
      nodes: base.nodes.map((n) => ({
        ...n,
        profile: { ...n.profile, prompt: { systemPrompt: 'different words, same topology' } },
      })),
    }
    expect(structuralSignature(reworded)).toBe(structuralSignature(base))

    const [first, ...rest] = base.edges
    const recapped = { ...base, edges: [{ ...first!, maxTraversals: 2 }, ...rest] }
    expect(structuralSignature(recapped)).not.toBe(structuralSignature(base))

    expect(structuralSignature(shotLoop().graph)).not.toBe(structuralSignature(base))
  })
})
