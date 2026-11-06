// Flow graph check nodes -> real /bin/sh processes in the run's working directory; no model.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseCommittedJsonLines } from '../../src/durable/jsonl-file'
import { runGraph } from '../../src/runtime/supervise/graph'
import { graphWorkspace, loadGraphFile } from '../../src/runtime/supervise/graph-file'
import { graphFromStored } from '../../src/runtime/supervise/graph-registry'
import { validateStoredGraph } from '../../src/runtime/supervise/stored-graph-validation'

const yaml = `
graph: check-loop
workspace: cwd
params:
  target: { type: integer, default: 2 }
nodes:
  - id: build
    check:
      command: 'n=$(cat count 2>/dev/null || echo 0); n=$((n+1)); echo $n > count; echo "{\\"count\\": $n}"'
  - id: verify
    check:
      command: 'echo "count=$(cat count) target=\${params.target}"; test "$(cat count)" -ge \${params.target}'
  - id: report
    check:
      command: 'grep -q "\\"pass\\":true" "$GRAPH_EVIDENCE/verify.json" && cat "$GRAPH_EVIDENCE/build.json"'
entry: [build]
edges:
  - { kind: routes, from: build, to: verify, directive: { surface: delegates/worker-brief, version: 1 } }
  - kind: routes
    from: verify
    to: build
    when: { pointer: /pass, equals: false }
    maxTraversals: 3
    directive: { surface: delegates/worker-brief, version: 1 }
  - kind: routes
    from: verify
    to: report
    when: { pointer: /pass, equals: true }
    evidence: [build]
    directive: { surface: delegates/worker-brief, version: 1 }
budget: { maxIterations: 20 }
check: { node: report, pointer: /pass, equals: true }
`

it('runs check nodes, loops on /pass=false, and hands evidence to a downstream check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-check-nodes-'))
  try {
    const loaded = await loadGraphFile(join(directory, 'check-loop.yaml'), { source: yaml })
    expect(validateStoredGraph(loaded.graph).digest).toBe(loaded.graph.digest)
    expect(loaded.graph.workspace).toBe('cwd')
    expect(loaded.graph.nodes[0]).toEqual({
      id: 'build',
      profile: { name: 'build' },
      check: { command: expect.stringContaining('echo $n > count') },
    })
    const cwd = await graphWorkspace(loaded.graph, { cwd: join(directory, 'work'), runId: 'x' })
    await mkdir(cwd)
    const runDir = join(directory, 'run')
    const result = await runGraph(graphFromStored(loaded.graph), {
      backend: { backend: 'bridge', bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
      runDir,
      runId: 'check-loop',
      driverRetry: { enabled: false },
    })
    expect(result.result.kind, JSON.stringify(result.result)).toBe('winner')
    // build ran twice: verify failed at count 1, the /pass=false route looped back, then passed.
    expect((await readFile(join(cwd, 'count'), 'utf8')).trim()).toBe('2')
    if (result.result.kind === 'winner') {
      const report = (result.result.out as { report: Record<string, unknown> }).report
      expect(report).toMatchObject({ pass: true, exitCode: 0, json: { json: { count: 2 } } })
      expect(report.output).toContain('{"pass":true')
    }
    const routed = result.ledger.filter((row) => row.kind === 'routes').map((row) => row.to)
    expect(routed).toEqual(['build', 'verify', 'build', 'verify', 'report'])
    const file = join(runDir, 'command-checks.jsonl')
    const receipts = parseCommittedJsonLines<Record<string, unknown>>(
      await readFile(file, 'utf8'),
      file,
    )
    expect(receipts.map((row) => [row.nodeName, row.exitCode])).toEqual([
      ['build', 0],
      ['verify', 1],
      ['build', 0],
      ['verify', 0],
      ['report', 0],
    ])
    expect(receipts[1]).toMatchObject({ valid: false, output: 'count=1 target=2\n' })

    const fresh = await graphWorkspace(
      { workspace: 'fresh' },
      { cwd, runId: 'check-loop', root: join(directory, 'workspaces') },
    )
    expect(fresh).toBe(join(directory, 'workspaces', 'check-loop'))
    await expect(
      loadGraphFile(join(directory, 'rooted.yaml'), {
        source: yaml.replace('entry: [build]\n', ''),
      }),
    ).rejects.toThrow('check nodes run only in a flow graph')
    await expect(
      loadGraphFile(join(directory, 'mixed.yaml'), {
        source: yaml.replace('  - id: report\n', '  - id: report\n    seat: codex\n'),
      }),
    ).rejects.toThrow('takes no profile, seat or needs')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
