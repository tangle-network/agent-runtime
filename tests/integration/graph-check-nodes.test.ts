// Flow graph check nodes -> real /bin/sh processes in the run's working directory; no model.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Sandbox } from '@tangle-network/sandbox'
import { expect, it, onTestFinished } from 'vitest'
import { parseCommittedJsonLines } from '../../src/durable/jsonl-file'
import type { IsolatedCheckOutputEvidence } from '../../src/runtime/isolated-checker'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import { runGraph } from '../../src/runtime/supervise/graph'
import { graphWorkspace, loadGraphFile } from '../../src/runtime/supervise/graph-file'
import { graphFromStored } from '../../src/runtime/supervise/graph-registry'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { validateStoredGraph } from '../../src/runtime/supervise/stored-graph-validation'

const run = promisify(execFile)

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

it('retains fresh logs from repeated local checks and refuses unchanged stale output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-check-output-local-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const source = `
graph: local-output
nodes:
  - id: verify
    check:
      command: 'n=$(cat count 2>/dev/null || echo 0); n=$((n+1)); echo $n > count; echo attempt=$n > verification.log; test $n -ge 2'
      outputs: { paths: [verification.log], maxFileBytes: 1024, maxTotalBytes: 1024 }
entry: [verify]
edges:
  - { kind: routes, from: verify, to: verify, when: { pointer: /pass, equals: false }, maxTraversals: 1, directive: { surface: delegates/worker-brief, version: 1 } }
  - { kind: routes, from: verify, to: { finish: checked }, when: { pointer: /pass, equals: true }, directive: { surface: delegates/worker-brief, version: 1 } }
budget: { maxIterations: 4 }
check: { node: verify, pointer: /pass, equals: true }
`
  const loaded = await loadGraphFile(join(directory, 'local.yaml'), { source })
  const options = {
    backend: { backend: 'bridge' as const, bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
    runDir: join(directory, 'run'),
    runId: 'local-output',
    driverRetry: { enabled: false },
  }
  expect(() => runGraph(graphFromStored(loaded.graph), options)).toThrow(
    'outputs require checkArtifacts',
  )
  await expect(readFile(join(cwd, 'verification.log'))).rejects.toMatchObject({ code: 'ENOENT' })
  for (const path of ['../private.log', '.git/config', '*.log'])
    await expect(
      loadGraphFile(join(directory, 'unsafe.yaml'), {
        source: source.replace('paths: [verification.log]', `paths: [${JSON.stringify(path)}]`),
      }),
    ).rejects.toThrow('portable relative files')
  const checkArtifacts = createPrivateCasArtifactPort(join(directory, 'cas'), 'local-output')
  const result = await runGraph(graphFromStored(loaded.graph), { ...options, checkArtifacts })
  expect(result.result.kind).toBe('winner')
  const file = join(options.runDir, 'command-checks.jsonl')
  const receipts = parseCommittedJsonLines<{
    valid: boolean
    outputs: IsolatedCheckOutputEvidence
  }>(await readFile(file, 'utf8'), file)
  expect(receipts).toMatchObject([
    { valid: false, outputs: { status: 'retained' } },
    { valid: true, outputs: { status: 'retained' } },
  ])
  const stale = await loadGraphFile(join(directory, 'stale.yaml'), {
    source: source
      .replace(/command: '[^\n]*'/, "command: 'true'")
      .replace(
        'check: { node: verify, pointer: /pass, equals: true }',
        'check: { node: verify, pointer: /outputs/status, equals: incomplete }',
      )
      .replace(/edges:[\s\S]*?budget:/, 'edges: []\nbudget:'),
  })
  const staleResult = await runGraph(graphFromStored(stale.graph), {
    ...options,
    runId: 'stale-output',
    runDir: join(directory, 'stale-run'),
    checkArtifacts,
  })
  expect(staleResult.result.kind).toBe('winner')
  expect(JSON.stringify(staleResult.result)).toContain('capture-failed')
  await rm(cwd, { recursive: true })
  const logs = await Promise.all(
    receipts.map(async (receipt) =>
      Buffer.from(await checkArtifacts.read(receipt.outputs.files[0]!.artifact)).toString(),
    ),
  )
  expect(logs).toEqual(['attempt=1\n', 'attempt=2\n'])
}, 60_000)

/** Run one box check node against a Sandbox HTTP peer. The peer runs the box's `find` for real over
 *  the uploaded tree. Unless `tear` is set it refuses the check's `/bin/sh` the way the box's sidecar
 *  refuses an executable it cannot start; with `tear` it runs it, and ends each process's first
 *  log stream before its exit event, as a dropped connection does. */
async function boxCheck(
  runtimeField: string,
  tear = false,
  capture?: { exit: number; missing?: boolean },
) {
  const directory = await mkdtemp(join(tmpdir(), 'graph-check-runtime-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'box')
  const creates: Record<string, unknown>[] = []
  const requests: string[] = []
  const ran: { stdout: string; exitCode: number }[] = []
  const torn = new Set<number>()
  const box = {
    id: 'sandbox-check-box',
    status: 'running',
    createdAt: new Date(0).toISOString(),
    filesystemIncarnationId: '11111111-1111-4111-8111-111111111111',
    filesystemIncarnationProvenance: 'fresh',
    filesystemIncarnationReadiness: 'ready',
    resources: { cpuCores: 8, memoryMB: 16384, diskGB: 10 },
    egressPolicy: { mode: 'blocked' },
    createReceipt: {
      outcome: 'created',
      idempotencyKeyApplied: true,
      ownerContext: 'isolated',
      injectedSecrets: [],
    },
  }
  const answer = async (method: string, path: string, body: Buffer, type = '') => {
    const self = `/v1/sandboxes/${box.id}`
    const runtime = `${self}/runtime`
    if (path === '/v1/me') {
      const id = 'cust_graph_owner'
      const me = { customer_id: id, billing_owner_id: id, api_key_id: null }
      return { data: { ...me, billing_delegation_authorized: false }, success: true }
    }
    if (method === 'POST' && path === '/v1/sandboxes') {
      creates.push(JSON.parse(body.toString('utf8')))
      return box
    }
    if (path === self) {
      if (method === 'DELETE') {
        await rm(root, { recursive: true, force: true })
        return { outcome: 'destroyed' }
      }
      return box
    }
    if (path === `${self}/stop`) {
      box.status = 'stopped'
      return box
    }
    if (path === `${runtime}/fs/upload-dir`) {
      const form = await new Response(body, { headers: { 'content-type': type } }).formData()
      const archive = form.get('archive') as Blob
      const into = join(root, String(form.get('path')))
      await mkdir(into, { recursive: true })
      await writeFile(join(directory, 'upload.tar.gz'), Buffer.from(await archive.arrayBuffer()))
      await run('tar', ['-xzf', join(directory, 'upload.tar.gz'), '-C', into])
      return { success: true }
    }
    if (path === `${runtime}/process/spawn`) {
      const spawn = JSON.parse(body.toString('utf8'))
      if (spawn.executable === '/bin/sh' && !tear) {
        const message = 'Command setup failed (identity, cwd or exec): ENOENT'
        return { status: 500, body: { success: false, error: { code: 'SPAWN_FAILED', message } } }
      }
      const args = [...spawn.args]
      if (spawn.executable === '/usr/bin/python3') args[4] = join(root, args[4])
      const done = await run(spawn.executable, args, {
        cwd: spawn.cwd ? join(root, spawn.cwd) : root,
        env: { ...process.env, ...spawn.env },
      }).then(
        (out) => ({ stdout: out.stdout, exitCode: 0 }),
        (error: { stdout: string; code: number }) => ({
          stdout: error.stdout,
          exitCode: error.code,
        }),
      )
      ran.push(done)
      // Artifact capture uses stdout/stderr file streams; the fixture tears command logs only.
      if (spawn.executable === '/usr/bin/python3') torn.add(ran.length)
      return { data: { pid: ran.length } }
    }
    const pid = Number(/\/process\/(\d+)/.exec(path)?.[1])
    if (path.endsWith('/logs')) {
      const output = `event: stdout\ndata: ${JSON.stringify({ data: ran[pid - 1]?.stdout, timestamp: 1 })}\n\n`
      if (tear && !torn.has(pid)) return torn.add(pid) && output
      return `${output}event: exit\ndata: {}\n\n`
    }
    if (pid)
      return {
        data: { pid, running: false, exitCode: ran[pid - 1]?.exitCode, startedAt: box.createdAt },
      }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: path } } }
  }
  const peer = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', async () => {
      const path = new URL(request.url ?? '/', 'http://peer').pathname
      requests.push(`${request.method} ${path}`)
      const type = request.headers['content-type']
      const out = await answer(request.method ?? '', path, Buffer.concat(chunks), type)
      if (typeof out === 'string') {
        response.setHeader('content-type', 'text/event-stream')
        return response.end(out)
      }
      response.setHeader('content-type', 'application/json')
      const failed = 'status' in out && typeof out.status === 'number'
      response.statusCode = failed ? out.status : 200
      response.end(JSON.stringify(failed ? out.body : out))
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
      command: '${capture ? `printf "before=$PROOF_SECRET\\n" > verification.log; head -c 90000 /dev/zero >> verification.log; echo landed; exit ${capture.exit}` : 'echo landed'}'
      environment: agent-container
      resources: { cpuCores: 8, memoryMB: 16384 }${runtimeField}${
        capture
          ? `
      secrets: [PROOF_SECRET]
      outputs:
        paths: [verification.log${capture.missing ? ', missing.log' : ''}]
        maxFileBytes: 100000
        maxTotalBytes: 200000`
          : ''
      }
entry: [verify]
edges: []
budget: { maxIterations: 2 }
check: { node: verify, pointer: /pass, equals: true }
`,
  })
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const context = createInMemoryRunContext()
  const artifacts = createPrivateCasArtifactPort(join(directory, 'cas'), 'graph-check-proof')
  const outcome = await runGraph(graphFromStored(loaded.graph), {
    backend: { backend: 'bridge', bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: '', cwd },
    ...(capture
      ? { runContext: context, checkArtifacts: artifacts }
      : { runDir: join(directory, 'run') }),
    runId: 'check-box-runtime',
    driverRetry: { enabled: false },
    checkPlacement: {
      env: { PROOF_SECRET: 'private-check-log-secret' },
      client: new Sandbox({
        apiKey: 'no-live-credentials',
        baseUrl: `http://127.0.0.1:${address.port}`,
        directExec: false,
      }),
    },
  }).catch((error: unknown) => error)
  expect(creates.length).toBeGreaterThan(0)
  for (const body of creates)
    expect(body).toMatchObject({ environment: 'agent-container', ownerContext: 'isolated' })
  const said = outcome instanceof Error ? outcome.message : JSON.stringify(outcome)
  const evidence = []
  for (const event of (await context.journal.loadTree('check-box-runtime')) ?? [])
    if (event.kind === 'execution-evidence') evidence.push(await context.blobs.get(event.outRef))
  return { creates, requests, said, evidence, directory, artifacts }
}

it('a box check node sends its runtime in the Sandbox create, and none when unset', async () => {
  for (const body of (await boxCheck('\n      runtime: firecracker')).creates)
    expect(body.runtime).toBe('firecracker')
  for (const body of (await boxCheck('')).creates) expect(body).not.toHaveProperty('runtime')
}, 60_000)

it('a box that cannot start the check command refuses it and is deleted', async () => {
  const { requests, said } = await boxCheck('')
  expect(said, requests.join('\n')).toContain(
    'check node verify box refused: Command setup failed (identity, cwd or exec): ENOENT',
  )
  expect(requests.filter((line) => line.endsWith('/process/spawn'))).toHaveLength(2)
  expect(requests).toContain('DELETE /v1/sandboxes/sandbox-check-box')
}, 60_000)

it('a box check whose log stream ends before its exit reads the retained output again', async () => {
  const { requests, said } = await boxCheck('', true)
  expect(said, requests.join('\n')).not.toContain('refused')
  expect(said).toContain('"kind":"winner"')
  expect(said).toContain('landed')
  expect(requests.filter((line) => line.endsWith('/process/2/logs'))).toHaveLength(2)
}, 60_000)

it('retains complete redacted check logs in run evidence after cloud cleanup on success and failure', async () => {
  for (const exit of [0, 7]) {
    const result = await boxCheck('', true, { exit })
    expect(result.requests).toContain('DELETE /v1/sandboxes/sandbox-check-box')
    const receipt = result.evidence
      .map(
        (value) =>
          (
            value as {
              graphCheckReceipt?: {
                exitCode: number
                valid: boolean
                outputs: IsolatedCheckOutputEvidence
              }
            }
          ).graphCheckReceipt,
      )
      .find(Boolean)!
    expect(receipt).toMatchObject({
      exitCode: exit,
      valid: exit === 0,
      outputs: { status: 'retained', missing: [] },
    })
    const reopened = createPrivateCasArtifactPort(
      join(result.directory, 'cas'),
      'graph-check-proof',
    )
    const bytes = Buffer.from(await reopened.read(receipt.outputs.files[0]!.artifact))
    expect(bytes.toString('utf8')).toBe(`before=[redacted:PROOF_SECRET]\n${'\0'.repeat(90000)}`)
    expect(JSON.stringify(result.evidence)).not.toContain('private-check-log-secret')
    expect(result.said).not.toContain('private-check-log-secret')
  }
}, 60_000)

it('records incomplete retention as a failed check and keeps private recovery custody out of routed output', async () => {
  const result = await boxCheck('', true, { exit: 0, missing: true })
  const receipt = result.evidence
    .map(
      (value) =>
        (
          value as {
            graphCheckReceipt?: {
              valid: boolean
              outputs: IsolatedCheckOutputEvidence
            }
          }
        ).graphCheckReceipt,
    )
    .find(Boolean)!
  expect(receipt).toMatchObject({
    valid: false,
    outputs: {
      status: 'incomplete',
      missing: [{ path: 'missing.log', reason: 'missing' }],
      source: { kind: 'sandbox', sandboxId: 'sandbox-check-box', state: 'stopped' },
    },
  })
  expect(result.requests).not.toContain('DELETE /v1/sandboxes/sandbox-check-box')
  expect(result.said).not.toContain('"source"')
}, 60_000)
