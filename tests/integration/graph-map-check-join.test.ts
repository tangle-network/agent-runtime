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
