// Flow graph check nodes -> real /bin/sh processes in the run's working directory; no model.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sandbox } from '@tangle-network/sandbox'
import { expect, it, onTestFinished } from 'vitest'
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
      command: 'echo "token=$GITHUB_TOKEN" >&2; n=$(cat count 2>/dev/null || echo 0); n=$((n+1)); echo $n > count; echo "{\\"count\\": $n}"'
      secrets: [GITHUB_TOKEN]
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
      check: {
        command: expect.stringContaining('echo $n > count'),
        secrets: ['GITHUB_TOKEN'],
      },
    })
    const cwd = await graphWorkspace(loaded.graph, { cwd: join(directory, 'work'), runId: 'x' })
    await mkdir(cwd)
    const runDir = join(directory, 'run')
    process.env.GITHUB_TOKEN = 'ghs_check_node_proof_secret'
    const result = await runGraph(graphFromStored(loaded.graph), {
      backend: { backend: 'bridge', bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
      runDir,
      runId: 'check-loop',
      driverRetry: { enabled: false },
    })
    expect(result.result.kind, JSON.stringify([result.stopped, result.ledger])).toBe('winner')
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
    // A resolved secret never leaves the check: not in a receipt, not in downstream evidence.
    const journal = await readFile(file, 'utf8')
    expect(journal).not.toContain('ghs_check_node_proof_secret')
    expect(receipts[0]?.output).toContain('token=[redacted:GITHUB_TOKEN]')
    if (result.result.kind === 'winner')
      expect(JSON.stringify(result.result.out)).toContain('[redacted:GITHUB_TOKEN]')

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

it('runs a local check when a declared secret is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-check-optional-secret-'))
  const previous = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  try {
    const loaded = await loadGraphFile(join(directory, 'optional.yaml'), {
      source: `
graph: check-optional-secret
workspace: cwd
nodes:
  - id: intake
    check:
      command: 'test -z "$GITHUB_TOKEN" && echo "{\\"ok\\":true}"'
      secrets: [GITHUB_TOKEN]
entry: [intake]
edges: []
budget: { maxIterations: 4 }
check: { node: intake, pointer: /pass, equals: true }
`,
    })
    const cwd = await graphWorkspace(loaded.graph, {
      cwd: join(directory, 'work'),
      runId: 'optional',
    })
    await mkdir(cwd)
    const result = await runGraph(graphFromStored(loaded.graph), {
      backend: { backend: 'bridge', bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
      runDir: join(directory, 'run'),
      runId: 'check-optional-secret',
      driverRetry: { enabled: false },
    })
    expect(result.result.kind, JSON.stringify([result.stopped, result.ledger])).toBe('winner')
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = previous
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

/** Run one box check node against a Sandbox HTTP peer that answers the owner's identity, then
 *  refuses each create and keeps its body. */
async function boxCreateBodies(runtimeField: string): Promise<Record<string, unknown>[]> {
  const directory = await mkdtemp(join(tmpdir(), 'graph-check-runtime-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const creates: Record<string, unknown>[] = []
  const peer = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && request.url === '/v1/me') {
        const id = 'cust_graph_owner'
        response.end(
          JSON.stringify({
            success: true,
            data: {
              customer_id: id,
              billing_owner_id: id,
              api_key_id: null,
              billing_delegation_authorized: false,
            },
          }),
        )
        return
      }
      if (request.method === 'POST' && request.url === '/v1/sandboxes')
        creates.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      response.statusCode = 400
      response.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'proof only' } }))
    })
  })
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        peer.close(() => resolve())
        peer.closeAllConnections()
      }),
  )
  const address = peer.address()
  if (!address || typeof address === 'string') throw new Error('missing local Sandbox peer')
  const loaded = await loadGraphFile(join(directory, 'box.yaml'), {
    source: `
graph: check-box-runtime
workspace: cwd
nodes:
  - id: verify
    check:
      command: 'true'
      environment: agent-container
      resources: { cpuCores: 8, memoryMB: 16384 }${runtimeField}
entry: [verify]
edges: []
budget: { maxIterations: 2 }
check: { node: verify, pointer: /pass, equals: true }
`,
  })
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  await runGraph(graphFromStored(loaded.graph), {
    backend: { backend: 'bridge', bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
    runDir: join(directory, 'run'),
    runId: 'check-box-runtime',
    driverRetry: { enabled: false },
    checkPlacement: {
      client: new Sandbox({
        apiKey: 'no-live-credentials',
        baseUrl: `http://127.0.0.1:${address.port}`,
      }),
    },
  }).catch((error: unknown) => error)
  expect(creates.length).toBeGreaterThan(0)
  for (const body of creates)
    expect(body).toMatchObject({ environment: 'agent-container', ownerContext: 'isolated' })
  return creates
}

it('a box check node sends its runtime in the Sandbox create, and none when unset', async () => {
  for (const body of await boxCreateBodies('\n      runtime: firecracker'))
    expect(body.runtime).toBe('firecracker')
  for (const body of await boxCreateBodies('')) expect(body).not.toHaveProperty('runtime')
}, 60_000)
