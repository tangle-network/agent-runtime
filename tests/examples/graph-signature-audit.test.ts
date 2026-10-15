/**
 * The deduplication audit: no two graph examples teach the same thing.
 *
 * `examples/graphs/catalog.ts` lists every graph an example builds, one entry per graph (each arm of
 * a comparison is its own entry). Two graphs are compared in two steps: `graphSignature` (topology
 * with widths, exact caps, providers and wording bucketed away), then, for graphs with equal
 * signatures, `ledgerShape` (what each offline run did: the driver's spawn waves, analyzes rows,
 * continuity and outcomes). This test fails when
 *
 *   1. two graphs share a signature AND a ledger shape (or cannot be told apart offline), unless
 *      one declares it reuses the other,
 *   2. a declared reuse names a graph with a different signature (a stale claim),
 *   3. an example's scenarios disagree on the topology,
 *   4. a file in examples/graphs is neither catalogued nor named as not-a-graph, or the README
 *      omits a catalogued example, or
 *   5. the fingerprints stop seeing what they must see, or start seeing what they must not
 *      (their own controls, including the two pairs a review found the first audit missed).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentGraph } from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'
import { bestOfN } from '../../examples/graphs/best-of-n'
import {
  type CatalogGraph,
  catalog,
  exampleShape,
  graphSignature,
  NOT_GRAPH_FILES,
} from '../../examples/graphs/catalog'
import { judgePanel } from '../../examples/graphs/judge-panel'
import { shotLoop } from '../../examples/graphs/shot-loop'
import { shotLoopResumed } from '../../examples/graphs/shot-loop-resumed'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../examples/graphs')

const byName = new Map(catalog.map((entry) => [entry.name, entry]))
const signatureOf = (entry: CatalogGraph) => graphSignature(entry.runs()[0]!.graph)
const entry = (name: string) => {
  const found = byName.get(name)
  if (!found) throw new Error(`no catalogued graph named ${name}`)
  return found
}
const declared = (a: CatalogGraph, b: CatalogGraph) =>
  a.reuses?.name === b.name || b.reuses?.name === a.name

describe('examples/graphs — structural deduplication audit', () => {
  it('every catalogued graph has a unique name, and every scenario of it has one topology', () => {
    expect(byName.size).toBe(catalog.length)
    for (const graph of catalog) {
      const signatures = new Set(graph.runs().map((run) => graphSignature(run.graph)))
      expect(signatures.size, `${graph.name}: scenarios disagree on the topology`).toBe(1)
    }
  })

  it('a declared reuse names a catalogued graph with the same signature', () => {
    for (const graph of catalog.filter((g) => g.reuses !== undefined)) {
      const target = entry(graph.reuses!.name)
      expect(signatureOf(graph), `${graph.name} claims ${target.name}'s topology`).toBe(
        signatureOf(target),
      )
    }
  })

  it('graphs that share a topology differ in ledger shape, unless one declares the reuse', async () => {
    const groups = new Map<string, CatalogGraph[]>()
    for (const graph of catalog) {
      const sig = signatureOf(graph)
      groups.set(sig, [...(groups.get(sig) ?? []), graph])
    }
    const shapes = new Map<string, Promise<string[] | undefined>>()
    const shapeOf = (graph: CatalogGraph) => {
      if (!shapes.has(graph.name)) shapes.set(graph.name, exampleShape(graph))
      return shapes.get(graph.name)!
    }
    const duplicates: string[] = []
    for (const members of groups.values()) {
      for (const [i, a] of members.entries()) {
        for (const b of members.slice(i + 1)) {
          if (declared(a, b)) continue
          const [shapeA, shapeB] = [await shapeOf(a), await shapeOf(b)]
          if (shapeA === undefined || shapeB === undefined) {
            duplicates.push(`${a.name} ~ ${b.name}: same topology, and one cannot run offline`)
          } else if (JSON.stringify(shapeA) === JSON.stringify(shapeB)) {
            duplicates.push(`${a.name} ~ ${b.name}: same topology and ledger shape ${shapeA}`)
          }
        }
      }
    }
    expect(duplicates).toEqual([])
  }, 120_000)

  it('flags the pairs the review found, and tells them apart by what the run did', async () => {
    // Same graph data once widths, exact caps and root grants are bucketed away.
    expect(signatureOf(entry('role-chain'))).toBe(signatureOf(entry('arm-comparison/best-of-3')))
    expect(signatureOf(entry('conditional-skip'))).toBe(signatureOf(entry('best-of-n')))

    const waves = async (name: string) =>
      ((await exampleShape(entry(name))) ?? []).map((s) => JSON.parse(s).waves)
    // role-chain spawns one stage per driver turn; best-of-3 spawns every candidate in one turn.
    expect(await waves('role-chain')).toEqual([['worker×1…']])
    expect(await waves('arm-comparison/best-of-3')).toEqual([['worker×many']])
    // conditional-skip runs the second stage only after, and only if, the first found something;
    // best-of-n spawns both candidates together.
    expect(await waves('conditional-skip')).toEqual([['worker×1'], ['worker×1…']])
    expect(await waves('best-of-n')).toEqual([['worker×many']])
  }, 60_000)

  it('every file in examples/graphs is catalogued or named as not a graph', () => {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.slice(0, -'.ts'.length))
    const known = new Set([...catalog.map((g) => g.file), ...Object.keys(NOT_GRAPH_FILES)])
    expect(files.filter((file) => !known.has(file))).toEqual([])
    expect([...known].filter((file) => !files.includes(file))).toEqual([])
  })

  it('the README catalog names every catalogued example', () => {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    expect(catalog.filter((g) => !readme.includes(`${g.file}.ts`)).map((g) => g.file)).toEqual([])
  })

  it('the signature ignores wording, providers, widths and an unstated cap, and sees the rest', () => {
    const base = bestOfN().graph
    const reworded: AgentGraph = {
      ...base,
      nodes: base.nodes.map((n) => ({
        ...n,
        profile: { ...n.profile, prompt: { systemPrompt: 'different words, same topology' } },
      })),
    }
    expect(graphSignature(reworded)).toBe(graphSignature(base))

    const panel = judgePanel().graph
    const reprovided: AgentGraph = {
      ...panel,
      nodes: panel.nodes.map((n) => ({
        ...n,
        profile: { ...n.profile, model: { provider: 'other', default: 'other/model' } },
      })),
    }
    expect(graphSignature(reprovided)).toBe(graphSignature(panel))

    const wider: AgentGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'coder-c', profile: { ...base.nodes[1]!.profile, name: 'coder-c' } },
      ],
      edges: [...base.edges, { ...base.edges[0]!, to: 'coder-c' }],
    }
    expect(graphSignature(wider)).toBe(graphSignature(base))

    const [first, ...rest] = base.edges
    const once = { ...base, edges: [{ ...first!, maxTraversals: 1 }, ...rest] }
    expect(graphSignature(once)).toBe(graphSignature(base))
    const looped = { ...base, edges: [{ ...first!, maxTraversals: 2 }, ...rest] }
    expect(graphSignature(looped)).not.toBe(graphSignature(base))

    // An analyst (shot-loop's lens) and a continuity (shot-loop-resumed) are topology.
    expect(graphSignature(shotLoop().graph)).not.toBe(graphSignature(shotLoopResumed().graph))
    expect(graphSignature(shotLoop().graph)).not.toBe(graphSignature(base))
  })
})
