import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  type AgentSpec,
  contentAddress,
  createPrivateCasArtifactPort,
  type ExecutorResult,
  graphFromStored,
  loadGraphFile,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { expect, it, onTestFinished } from 'vitest'
import { parseCommittedJsonLines } from '../../src/durable/jsonl-file'
import type { IsolatedCheckOutputEvidence } from '../../src/runtime/isolated-checker'

it('checks a complete map join with a real command, retains its bundle and replays it once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-map-check-join-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const directive = { surface: 'delegates/worker-brief', version: 1 }
  const check = {
    command: `python3 - <<'PY'
import json, os
from pathlib import Path
task = json.loads(Path(os.environ['GRAPH_INPUT']).read_text())['task']
assert task['items'] == 2
assert [row['index'] for row in task['results']] == [0, 1]
assert [row['result']['id'] for row in task['results']] == ['first', 'second']
assert task['failures'] == []
Path('bundle.json').write_text(json.dumps(task, sort_keys=True))
with Path('join-count').open('a') as count:
    count.write('joined\\n')
passed = all(row['result']['accepted'] for row in task['results'])
print(json.dumps({'accepted': passed, 'count': len(task['results'])}))
raise SystemExit(0 if passed else 1)
PY`,
    outputs: { paths: ['bundle.json'], maxFileBytes: 8192, maxTotalBytes: 8192 },
  }
  const source = (accepted: boolean) => ({
    graph: 'map-check-join',
    nodes: [
      {
        id: 'source',
        check: {
          command: `printf '%s\\n' '${JSON.stringify({
            items: [
              { id: 'first', accepted: true },
              { id: 'second', accepted },
            ],
          })}'`,
        },
      },
      {
        id: 'worker',
        profile: {
          name: 'worker',
          harness: 'cli-base',
          model: { provider: 'offline', default: 'offline/literal-result' },
        },
      },
      { id: 'gate', check },
    ],
    entry: ['source'],
    edges: [
      {
        kind: 'maps',
        from: 'source',
        pointer: '/json/items',
        to: 'worker',
        join: 'gate',
        directive,
        maxItems: 2,
        concurrency: 2,
        onItemFailure: 'all-or-refuse',
      },
      {
        kind: 'routes',
        from: 'gate',
        to: { stop: 'candidate-rejected' },
        when: { pointer: '/pass', equals: false },
        directive,
      },
      { kind: 'routes', from: 'gate', to: { finish: 'accepted' }, directive },
    ],
    budget: { maxIterations: 8 },
    check: { node: 'gate', pointer: '/pass', equals: true },
  })
  for (const accepted of [false, true]) {
    const cwd = join(directory, String(accepted), 'work')
    const runDir = join(directory, String(accepted), 'run')
    await mkdir(cwd, { recursive: true })
    const loaded = await loadGraphFile(join(cwd, 'graph.json'), {
      source: JSON.stringify(source(accepted)),
    })
    const artifacts = createPrivateCasArtifactPort(join(directory, 'cas'), String(accepted))
    let leaves = 0
    const options = {
      backend: { backend: 'cli-in-place' as const, workspacePath: cwd },
      runDir,
      runId: `map-check-${accepted}`,
      checkArtifacts: artifacts,
      driverRetry: { enabled: false },
      // The map items supply literal settled data through Runtime's public leaf seam. The join
      // must bypass that seam and execute the real command, capture and journal around it.
      makeLeafAgent: (profile: AgentProfile) => {
        let artifact: ExecutorResult<unknown> | undefined
        const executorSpec: AgentSpec = {
          profile,
          harness: null,
          executor: {
            runtime: 'literal-map-item',
            async execute(task) {
              expect(profile.name).toBe('worker')
              leaves += 1
              artifact = {
                out: task,
                outRef: contentAddress(task),
                verdict: { valid: true, score: 1 },
                spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
              }
              return artifact
            },
            async teardown() {
              return { destroyed: true }
            },
            resultArtifact() {
              if (!artifact) throw new Error('literal map item has not executed')
              return artifact
            },
          },
        }
        return {
          name: profile.name ?? 'worker',
          async act() {
            throw new Error('the literal map item executor owns execution')
          },
          executorSpec,
        }
      },
    }
    const graph = graphFromStored(loaded.graph)
    const result = await runGraph(graph, options)
    expect(result.result.kind, JSON.stringify(result)).toBe(accepted ? 'winner' : 'no-winner')
    if (!accepted) expect(result.stopped?.reason, JSON.stringify(result)).toBe('candidate-rejected')
    expect(leaves).toBe(2)
    expect(await readFile(join(cwd, 'join-count'), 'utf8')).toBe('joined\n')
    const file = join(runDir, 'command-checks.jsonl')
    const receipts = parseCommittedJsonLines<{
      nodeName: string
      valid: boolean
      outputs?: IsolatedCheckOutputEvidence
    }>(await readFile(file, 'utf8'), file)
    const receipt = receipts.find((row) => row.nodeName === 'gate')
    expect(receipt).toMatchObject({ valid: accepted, outputs: { status: 'retained', missing: [] } })
    expect(receipts.filter((row) => row.nodeName === 'gate')).toHaveLength(1)
    const replay = await runGraph(graph, options)
    expect(replay.result.kind).toBe(result.result.kind)
    expect(leaves).toBe(2)
    expect(await readFile(join(cwd, 'join-count'), 'utf8')).toBe('joined\n')
    await rm(cwd, { recursive: true })
    const retained = JSON.parse(
      Buffer.from(await artifacts.read(receipt!.outputs!.files[0]!.artifact)).toString(),
    )
    expect(retained.results.map((row: { result: unknown }) => row.result)).toEqual([
      { id: 'first', accepted: true },
      { id: 'second', accepted },
    ])
  }
  const refused = source(true)
  refused.nodes[1] = { id: 'worker', check } as (typeof refused.nodes)[number]
  const loaded = await loadGraphFile(join(directory, 'check-item.json'), {
    source: JSON.stringify(refused),
  })
  expect(() =>
    runGraph(graphFromStored(loaded.graph), {
      backend: {
        backend: 'bridge',
        bridgeUrl: 'http://127.0.0.1:1',
        bridgeBearer: '',
        cwd: directory,
      },
      runDir: join(directory, 'refused-run'),
      checkArtifacts: createPrivateCasArtifactPort(join(directory, 'cas'), 'refused'),
    }),
  ).toThrow('not a maps item')
}, 60_000)

it('replays map-join repair routes with the same source evidence and no repeated checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-map-check-repair-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'work')
  await mkdir(workspace)
  const directive = { surface: 'delegates/worker-brief', version: 1 }
  const source = {
    graph: 'map-check-repair',
    nodes: [
      {
        id: 'dispatch',
        check: {
          command: `python3 - <<'PYTHON'
import json, os
from pathlib import Path
task = json.loads(Path(os.environ['GRAPH_INPUT']).read_text())['task']
round = task['from']['result']['round'] if 'from' in task else task['round']
print(json.dumps({'round': round, 'items': [{'round': round}]}))
PYTHON`,
        },
      },
      {
        id: 'item',
        profile: {
          name: 'item',
          harness: 'cli-base',
          model: { provider: 'offline', default: 'offline/literal-result' },
        },
      },
      {
        id: 'gate',
        check: {
          command: `python3 - <<'PYTHON'
import json, os
from pathlib import Path
task = json.loads(Path(os.environ['GRAPH_INPUT']).read_text())['task']
round = task['results'][0]['result']['round']
result = {'round': round, 'accepted': round == 2}
Path('gate.json').write_text(json.dumps(result))
with Path('gate-count').open('a') as count:
    count.write(str(round) + chr(10))
print(json.dumps(result))
PYTHON`,
          outputs: { paths: ['gate.json'], maxFileBytes: 8192, maxTotalBytes: 8192 },
        },
      },
      {
        id: 'repair',
        profile: {
          name: 'repair',
          harness: 'cli-base',
          model: { provider: 'offline', default: 'offline/literal-result' },
        },
      },
    ],
    entry: [{ node: 'dispatch', task: { round: 0 } }],
    edges: [
      { kind: 'routes', from: 'dispatch', to: { finish: 'source' }, directive },
      {
        kind: 'maps',
        from: 'dispatch',
        pointer: '/json/items',
        to: 'item',
        join: 'gate',
        maxItems: 1,
        concurrency: 1,
        onItemFailure: 'all-or-refuse',
        directive,
      },
      {
        kind: 'routes',
        from: 'gate',
        to: { finish: 'accepted' },
        directive,
        when: { pointer: '/json/accepted', equals: true },
      },
      {
        kind: 'routes',
        from: 'gate',
        to: 'repair',
        directive,
        evidence: ['dispatch', 'gate'],
        maxTraversals: 2,
      },
      { kind: 'routes', from: 'repair', to: 'dispatch', directive },
    ],
    budget: { maxIterations: 32 },
    check: { node: 'gate', pointer: '/json/accepted', equals: true },
  }
  const loaded = await loadGraphFile(join(directory, 'graph.json'), {
    source: JSON.stringify(source),
  })
  const graph = graphFromStored(loaded.graph)
  const artifacts = createPrivateCasArtifactPort(join(directory, 'cas'), 'repair-replay')
  const executed: string[] = []
  const options = {
    backend: { backend: 'cli-in-place' as const, workspacePath: workspace },
    runDir: join(directory, 'run'),
    runId: 'map-check-repair',
    checkArtifacts: artifacts,
    driverRetry: { enabled: false },
    makeLeafAgent: (profile: AgentProfile) => {
      let artifact: ExecutorResult<unknown> | undefined
      const executorSpec: AgentSpec = {
        profile,
        harness: null,
        executor: {
          runtime: 'literal-repair',
          async execute(task: unknown) {
            executed.push(profile.name ?? 'unknown')
            const value = task as {
              from: { result: { json: { round: number } } }
              evidence: { dispatch: { json: { round: number } } }
            }
            if (profile.name === 'repair') {
              expect(value.evidence.dispatch.json.round).toBe(value.from.result.json.round)
            }
            const out =
              profile.name === 'repair' ? { round: value.from.result.json.round + 1 } : task
            artifact = {
              out,
              outRef: contentAddress(out),
              verdict: { valid: true, score: 1 },
              spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
            }
            return artifact
          },
          async teardown() {
            return { destroyed: true }
          },
          resultArtifact() {
            if (!artifact) throw new Error('literal repair has not executed')
            return artifact
          },
        },
      }
      return { name: profile.name ?? 'literal', act: async () => '', executorSpec }
    },
  }
  const initial = await runGraph(graph, options)
  expect(initial.result.kind, JSON.stringify(initial.stopped)).toBe('winner')
  expect(executed).toEqual(['item', 'repair', 'item', 'repair', 'item'])
  const counts = await readFile(join(workspace, 'gate-count'), 'utf8')
  expect(counts).toBe('0\n1\n2\n')
  const receiptPath = join(options.runDir, 'command-checks.jsonl')
  const receipts = await readFile(receiptPath, 'utf8')
  const replay = await runGraph(graph, { ...options, resume: true })
  expect(replay.result.kind, JSON.stringify(replay.stopped)).toBe('winner')
  if (replay.result.kind === 'winner' && initial.result.kind === 'winner') {
    expect(replay.result.out).toEqual(initial.result.out)
    expect(replay.result.spentTotal.iterations).toBe(initial.result.spentTotal.iterations)
  }
  expect(executed).toEqual(['item', 'repair', 'item', 'repair', 'item'])
  expect(await readFile(join(workspace, 'gate-count'), 'utf8')).toBe(counts)
  expect(await readFile(receiptPath, 'utf8')).toBe(receipts)

  const stoppedSource = {
    ...source,
    edges: [
      { kind: 'routes', from: 'dispatch', to: { stop: 'source-refused' }, directive },
      ...source.edges.slice(1),
    ],
  }
  const stoppedGraph = await loadGraphFile(join(directory, 'stopped.json'), {
    source: JSON.stringify(stoppedSource),
  })
  const stopped = await runGraph(graphFromStored(stoppedGraph.graph), {
    ...options,
    runDir: join(directory, 'stopped-run'),
    runId: 'map-source-stopped',
  })
  expect(stopped.result.kind).toBe('no-winner')
  expect(stopped.stopped?.reason).toBe('source-refused')
  expect(executed).toEqual(['item', 'repair', 'item', 'repair', 'item'])
  expect(stopped.ledger.filter((row) => row.kind === 'maps')).toEqual([])
}, 60_000)
