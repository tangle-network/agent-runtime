import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadGraphFile } from '../../src/runtime/supervise/graph-file'
import {
  graphDigest,
  graphFromStored,
  loadGraph,
  recordStoredGraphRun,
  type StoredGraph,
} from '../../src/runtime/supervise/graph-registry'
import { createPromptRegistry } from '../../src/runtime/supervise/prompt-registry'
import { validateStoredGraph } from '../../src/runtime/supervise/stored-graph-validation'
import { testAgentProfile } from '../kernel/test-agent-profile'

function redigest(graph: StoredGraph): StoredGraph {
  const { digest: _digest, ...content } = graph
  return { ...content, digest: graphDigest(content) }
}

it('validates compiled file data through the actual registry and deliverable consumers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stored-graph-validation-'))
  try {
    const authored = {
      params: { message: { type: 'string', default: 'from the authored parameter file' } },
      nodes: [{ id: 'worker', profile: testAgentProfile('worker') }],
      entry: [{ node: 'worker', task: { message: '${params.message}' } }],
      edges: [],
      budget: { maxIterations: 3, maxTokens: 100 },
      check: { node: 'worker', pointer: '/ok', equals: true },
    }
    const file = join(directory, 'authored.json')
    await writeFile(file, JSON.stringify(authored))
    // This entry accepts canonical compiled data, never authoring envelopes or partial seats.
    const authoredUnknown: unknown = JSON.parse(await readFile(file, 'utf8'))
    expect(() => validateStoredGraph(authoredUnknown)).toThrow()
    const loaded = await loadGraphFile(file)
    expect(loaded.graph.entry?.[0]?.task).toEqual({ message: 'from the authored parameter file' })
    const compiledFile = join(directory, 'compiled.json')
    await writeFile(compiledFile, JSON.stringify(loaded.graph))
    const raw: unknown = JSON.parse(await readFile(compiledFile, 'utf8'))
    const validated = validateStoredGraph(raw)
    expect(validated).toEqual(loaded.graph)
    expect(Object.isFrozen(validated)).toBe(true)
    const registry = { root: join(directory, 'registry') }
    await recordStoredGraphRun(registry, validated)
    const stored = await loadGraph(registry, validated.digest)
    expect(stored).toBeDefined()
    const reloaded = validateStoredGraph(stored)
    const graph = graphFromStored(reloaded)
    expect(await graph.deliverable.check({ worker: { ok: true } })).toBe(true)
    expect(await graph.deliverable.check({ worker: { ok: false } })).toBe(false)

    const changed = structuredClone(loaded.graph)
    ;(changed.entry![0]!.task as Record<string, unknown>).message = 'tampered after digesting'
    expect(() => validateStoredGraph(changed)).toThrow('digest does not match')
    expect(() => validateStoredGraph({ ...loaded.graph, observed: true })).toThrow()
    expect(() =>
      validateStoredGraph({ ...loaded.graph, on: { schedule: 'extra authoring data' } }),
    ).toThrow()
    expect(() =>
      validateStoredGraph({
        ...loaded.graph,
        nodes: [{ id: 'worker', profile: { name: 'worker' } }],
      }),
    ).toThrow('must be explicit')
    expect(() =>
      validateStoredGraph({
        ...loaded.graph,
        nodes: [{ id: 'worker', profile: { ...testAgentProfile('worker'), extraBehavior: true } }],
      }),
    ).toThrow()
    expect(() =>
      validateStoredGraph({
        ...loaded.graph,
        nodes: [{ id: 'worker', profile: testAgentProfile('different') }],
      }),
    ).toThrow('profile.name')

    const command = redigest({
      ...loaded.graph,
      deliverable: {
        checkRef: 'command',
        command: { command: 'test -f artifact.txt', timeoutMs: 5000 },
      },
    })
    expect(validateStoredGraph(command)).toEqual(command)
    expect(() => validateStoredGraph({ ...command, deliverable: { checkRef: 'command' } })).toThrow(
      'requires only command',
    )
    expect(() =>
      validateStoredGraph({
        ...command,
        deliverable: { checkRef: 'command', command: { command: 'exit 0', executable: true } },
      }),
    ).toThrow()
    const named = redigest({ ...loaded.graph, deliverable: { checkRef: 'environment-check' } })
    expect(() => validateStoredGraph(named)).toThrow('unknown checkRef')
    let calls = 0
    expect(
      validateStoredGraph(named, {
        checks: {
          'environment-check': () => {
            calls += 1
            return true
          },
        },
      }),
    ).toEqual(named)
    expect(calls).toBe(0)
    expect(() =>
      validateStoredGraph(named, { checks: Object.create({ 'environment-check': () => true }) }),
    ).toThrow('unknown checkRef')

    const directive = { surface: 'integration/custom-directive', version: 1 }
    const routed = redigest({
      ...loaded.graph,
      edges: [{ kind: 'routes', from: 'worker', to: { finish: 'done' }, directive }],
    })
    expect(() => validateStoredGraph(routed)).toThrow()
    const prompts = createPromptRegistry([{ ...directive, text: 'Deliver the checked output.' }])
    expect(validateStoredGraph(routed, { registry: prompts })).toEqual(routed)
    expect(() =>
      validateStoredGraph(
        { ...routed, edges: [{ ...routed.edges[0], unexpectedAuthority: true }] },
        { registry: prompts },
      ),
    ).toThrow()
    const dangling = redigest({
      ...routed,
      edges: [{ kind: 'routes', from: 'worker', to: 'missing', directive }],
    })
    expect(() => validateStoredGraph(dangling, { registry: prompts })).toThrow('unknown node')

    const executable = { ...loaded.graph, deliverable: { checkRef: 'route', check: () => true } }
    expect(() => validateStoredGraph(executable)).toThrow('JSON data')
    const cyclic = structuredClone(loaded.graph)
    ;(cyclic.entry![0]!.task as Record<string, unknown>).cycle = cyclic
    expect(() => validateStoredGraph(cyclic)).toThrow('acyclic JSON')
    const nonfinite = structuredClone(loaded.graph)
    ;(nonfinite.entry![0]!.task as Record<string, unknown>).number = Number.NaN
    expect(() => validateStoredGraph(nonfinite)).toThrow('finite')
    expect(() => validateStoredGraph({ ...loaded.graph, hiddenDate: new Date() })).toThrow(
      'plain JSON',
    )
    let getterCalls = 0
    const accessor = Object.defineProperty({ ...loaded.graph }, 'untrusted', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'must not execute'
      },
    })
    expect(() => validateStoredGraph(accessor)).toThrow('accessors')
    expect(getterCalls).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
