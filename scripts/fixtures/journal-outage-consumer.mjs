import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer, request as proxyRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'

const [mode, directory, endpoint, fault = 'dispatch'] = process.argv.slice(2)
const kernelModule = process.env.RUNTIME_KERNEL_MODULE ?? '@tangle-network/agent-runtime/kernel'
const durableModule = process.env.RUNTIME_DURABLE_MODULE ?? '@tangle-network/agent-runtime/durable'
const kernel = await import(kernelModule)
const durable = await import(durableModule)
const profile = {
  name: 'retained-local-child',
  harness: 'opencode',
  model: { provider: 'offline', default: 'offline-process' },
}
const runId = 'journal-outage'
const rootProfile = { ...profile, name: 'local-controller' }
const controllerProfile = {
  ...rootProfile,
  tools: Object.fromEntries(
    ['spawn_worker', 'await_event', 'stop'].map((name) => [
      `agent_runtime_coordination_${name}`,
      true,
    ]),
  ),
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const capabilities = {
  create: { runtimeAttachments: { mcp: true } },
  profile: {
    namedProfiles: true,
    systemPrompt: { replace: true, append: true },
    instructions: true,
    tools: true,
    permissions: true,
    mcp: true,
    subagents: true,
    resources: { files: true, instructions: true },
    runtimeUpdate: true,
    validation: true,
  },
  workspace: { read: false, write: false, exec: false, git: false, upload: false, download: false },
  branching: { checkpoint: false, fork: false },
  placement: false,
  usage: true,
  confidential: false,
  streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
  sessions: { continue: true, list: true, messages: true },
  retainedControl: {
    exactRunIdentity: true,
    resultIdentity: true,
    eventIdentity: true,
    cancellationIdempotency: true,
  },
}

if (mode === 'controller') {
  const phase = fault.split(':')[0]
  const faultPoint = fault.split(':')[1]
  const rootOwner = fault.split(':')[2] === 'root'
  let injected = false
  if (phase === 'interrupt') {
    const open = fs.open.bind(fs)
    fs.open = async (path, flags, ...rest) => {
      const handle = await open(path, flags, ...rest)
      if (String(path) !== join(directory, 'spawn-journal.jsonl') || flags !== 'a') return handle
      const write = handle.write.bind(handle)
      handle.write = async (...args) => {
        const text = args[0].toString()
        const matched =
          faultPoint === 'result'
            ? text.includes('"kind":"execution-result"')
            : text.includes('"phase":"dispatched"')
        if (injected || !matched) return write(...args)
        injected = true
        if (faultPoint === 'partial')
          await write(Buffer.from(text.slice(0, Math.floor(text.length / 2))))
        // Linux supplies a real bounded ENOSPC; no mount, host disk filling, or source deletion.
        const full = await open('/dev/full', 'w')
        try {
          await full.write(Buffer.from('bounded journal fault'))
        } catch (error) {
          await fs.writeFile(
            join(directory, 'injected.json'),
            JSON.stringify({ code: error.code, syscall: error.syscall, faultPoint }),
          )
          throw error
        } finally {
          await full.close()
        }
      }
      return handle
    }
  }
  syncBuiltinESMExports()
  const rpc = async (method, input) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, input }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }
  const environment = () => ({
    id: 'local-environment',
    provider: 'local-process',
    status: async () => 'running',
    async *stream() {},
    dispatch: (input) => rpc('dispatch', input),
    session: (id, options) => ({
      id,
      controlRef: options?.controlRef,
      status: () => rpc('status'),
      async *events() {
        for (const event of await rpc('events')) yield event
      },
      result: () => rpc('result'),
      prompt: async () => {
        throw new Error('no new prompt is authorized during recovery')
      },
      cancelRun: (request) => rpc('cancel', request),
    }),
    destroy: () => rpc('destroy'),
  })
  const provider = {
    name: 'local-process',
    capabilities: async () => capabilities,
    create: async (input) => {
      await rpc('create', input)
      return environment()
    },
    get: async (id) => ((await rpc('get', id)) ? environment() : null),
    list: () => rpc('list'),
  }
  const factory = kernel.providerAsExecutor(provider, { destroyOnSettle: false })
  const worker = () => ({
    name: profile.name,
    act: async () => {
      throw new Error('provider executor must own execution')
    },
    executorSpec: { profile, harness: profile.harness, executorFactory: factory },
  })
  const tool = async (url, name, args) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(10000),
    })
    const body = await response.json()
    if (!response.ok || body.error || body.result?.isError) throw new Error(JSON.stringify(body))
  }
  let outcome
  try {
    const result = await durable.supervisePursuit(
      rootOwner ? rootProfile : controllerProfile,
      'retain the exact local computation',
      {
        pursuitId: 'local-journal-outage',
        runId,
        runDir: directory,
        budget: { maxIterations: 20, maxTokens: 1000, deadlineMs: 30000 },
        perWorker: { maxIterations: 2, maxTokens: 100, deadlineMs: 20000 },
        ...(rootOwner
          ? {
              backend: { backend: 'provider', provider },
              driverBackend: { backend: 'provider', provider },
              coordination: {
                authentication: {
                  signingKeys: {
                    activeKeyId: 'fixture',
                    keys: { fixture: 'offline-test-key-'.repeat(4) },
                  },
                },
                publicUrl: async (address) => {
                  await rpc('forward', address.port)
                  return `${endpoint}/mcp`
                },
              },
            }
          : { makeWorkerAgent: worker, recoverExecutor: factory }),
        driverRetry: { enabled: false },
        childSettleGraceMs: 1000,
        teardownConfirmMs: 0,
        ...(rootOwner
          ? {}
          : {
              driveHarness: async ({ coordinationMcpUrl }) => {
                if (phase === 'interrupt')
                  await tool(coordinationMcpUrl, 'spawn_worker', {
                    profile,
                    task: 'compute 21 + 21',
                    key: 'one-computation',
                    label: 'native child',
                  })
                await tool(coordinationMcpUrl, 'await_event', { kinds: ['settled'] })
                await tool(coordinationMcpUrl, 'stop', {})
              },
            }),
        finalizer: async () => {
          const events = await new kernel.FileSpawnJournal(
            join(directory, 'spawn-journal.jsonl'),
          ).loadTree(runId)
          return events?.some((event) => event.kind === 'execution-result')
            ? { answer: 42 }
            : undefined
        },
      },
    )
    outcome = { status: 'settled', kind: result.result.kind }
  } catch (error) {
    outcome = { status: 'interrupted', name: error.name, message: error.message }
  }
  console.log(
    JSON.stringify({
      ...outcome,
      injected,
      resultExists: existsSync(join(directory, 'result.json')),
    }),
  )
} else {
  assert.equal(process.platform, 'linux', 'the bounded kernel ENOSPC fixture uses /dev/full')
  const root = directory
    ? resolve(directory)
    : await fs.mkdtemp(join(tmpdir(), 'runtime-journal-outage-'))
  await fs.mkdir(root, { recursive: true })
  const rootOwner = mode?.startsWith('root-') ?? false
  const faultPoint = (rootOwner ? mode.slice(5) : mode) ?? 'dispatch'
  let creates = 0
  let dispatchCalls = 0
  let starts = 0
  let destroys = 0
  let alive = false
  let controlRef
  let createMaterial
  let coordinationPort
  let worker
  let done
  const completed = new Promise((resolveDone) => {
    done = resolveDone
  })
  const server = createServer(async (request, response) => {
    if (request.url === '/mcp') {
      const target = proxyRequest(
        {
          hostname: '127.0.0.1',
          port: coordinationPort,
          path: '/mcp',
          method: request.method,
          headers: { ...request.headers, host: `127.0.0.1:${coordinationPort}` },
        },
        (upstream) => {
          response.writeHead(upstream.statusCode ?? 502, upstream.headers)
          upstream.pipe(response)
        },
      )
      target.on('error', () => response.writeHead(502).end())
      response.on('close', () => target.destroy())
      request.pipe(target)
      return
    }
    try {
      let raw = ''
      for await (const bytes of request) raw += bytes
      const { method, input } = JSON.parse(raw)
      let value
      if (method === 'forward') {
        coordinationPort = input
        value = true
      } else if (method === 'create') {
        if (createMaterial) assert.equal(input.idempotencyKey, createMaterial.idempotencyKey)
        else {
          creates++
          createMaterial = input
        }
        assert.deepEqual(input.profile, rootOwner ? rootProfile : profile)
        value = true
      } else if (method === 'get') value = creates > 0 && destroys === 0
      else if (method === 'list')
        value =
          creates > 0
            ? [
                {
                  id: 'local-environment',
                  provider: 'local-process',
                  metadata: createMaterial.metadata,
                },
              ]
            : []
      else if (method === 'dispatch') {
        dispatchCalls++
        if (controlRef) {
          assert.equal(input.executionId, controlRef.executionId)
          assert.equal(input.sessionId, controlRef.sessionId)
        } else {
          starts++
          controlRef = {
            provider: 'local-process',
            environmentId: 'local-environment',
            sessionId: input.sessionId,
            executionId: input.executionId,
            runId: `native:${input.turnId}`,
            requestDigest: canonicalCandidateDigest({ prompt: input.prompt, turnId: input.turnId }),
          }
          await fs.writeFile(join(root, 'native-control.json'), JSON.stringify(controlRef))
          const code = `const fs=require('node:fs'); const root=process.argv[1]; let ticks=0; const timer=setInterval(()=>{ fs.writeFileSync(root+'/heartbeat',String(++ticks)); if(fs.existsSync(root+'/complete')) { fs.writeFileSync(root+'/native-result.json',JSON.stringify({answer:21+21,pid:process.pid,ticks})); clearInterval(timer); } },25); setTimeout(()=>{clearInterval(timer);process.exit(2)},15000).unref()`
          worker = spawn(process.execPath, ['-e', code, root], { stdio: 'ignore' })
          alive = true
          worker.once('exit', (code) => {
            alive = false
            done(code)
          })
          if (faultPoint === 'result') await fs.writeFile(join(root, 'complete'), '')
        }
        value = { id: controlRef.sessionId, provider: 'local-process', controlRef }
      } else if (method === 'status') value = alive ? 'running' : 'completed'
      else if (method === 'events') {
        value = [
          {
            id: 'native-start',
            type: 'status',
            data: { sequence: 0, occurredAt: new Date().toISOString() },
            normalized: { type: 'status', status: 'started' },
          },
        ]
        if (alive) await completed
      } else if (method === 'result') {
        assert.equal(alive, false)
        value = {
          success: true,
          text: '42',
          sessionId: controlRef.sessionId,
          usage: { inputTokens: 0, outputTokens: 0 },
          metadata: {
            executionId: controlRef.executionId,
            runId: controlRef.runId,
            requestDigest: controlRef.requestDigest,
          },
        }
      } else if (method === 'destroy') {
        destroys++
        if (alive) worker.kill()
        value = true
      } else throw new Error(`unexpected provider operation ${method}`)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(value))
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  const url = `http://127.0.0.1:${server.address().port}`
  const phase = (name) =>
    new Promise((accept, reject) => {
      const child = spawn(
        process.execPath,
        [
          ...process.execArgv,
          fileURLToPath(import.meta.url),
          'controller',
          root,
          url,
          `${name}:${faultPoint}:${rootOwner ? 'root' : 'child'}`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (bytes) => {
        stdout += bytes
      })
      child.stderr.on('data', (bytes) => {
        stderr += bytes
      })
      const timeout = setTimeout(() => child.kill('SIGKILL'), 20000)
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        fs.writeFile(join(root, `${name}.log`), stdout + '\n' + stderr).then(() => {
          if (code !== 0) reject(new Error(`controller ${name}: ${code}/${signal} ${stderr}`))
          else accept(JSON.parse(stdout.trim().split('\n').at(-1)))
        }, reject)
      })
      child.once('error', reject)
    })
  const receipt = { faultPoint, rootOwner, root, kernelModule, durableModule }
  try {
    receipt.first = await phase('interrupt')
    receipt.firstNativeAlive = alive
    receipt.firstCreates = creates
    receipt.firstStarts = starts
    receipt.firstDestroys = destroys
    receipt.fault = JSON.parse(await fs.readFile(join(root, 'injected.json'), 'utf8'))
    const journal = new kernel.FileSpawnJournal(join(root, 'spawn-journal.jsonl'))
    const before = await journal.loadTree(runId)
    const originalBytes = await fs.readFile(join(root, 'spawn-journal.jsonl'))
    const committedPrefix = originalBytes.subarray(0, originalBytes.lastIndexOf(10) + 1)
    await fs.writeFile(join(root, 'interrupted-journal.jsonl'), originalBytes)
    receipt.pendingAdmissions = before
      .filter((event) => event.kind === 'execution-admitted')
      .map((event) => event.admission)
    assert.equal(receipt.fault.code, 'ENOSPC')
    if (process.env.RUNTIME_EXPECT_LEGACY_FAILURE === '1') {
      assert.equal(receipt.first.status, 'settled')
      assert.equal(receipt.first.resultExists, true)
      receipt.second = await phase('resume')
      assert.equal(receipt.second.status, 'interrupted')
      assert.match(receipt.second.message, /settled/)
      receipt.legacyTerminalGuardBlockedRecovery = true
      receipt.passed = true
    } else {
      assert.equal(receipt.first.status, 'interrupted')
      assert.equal(receipt.first.resultExists, false)
      assert.equal(destroys, 0)
      if (faultPoint !== 'result') assert.equal(alive, true)
      assert.equal(starts, 1)
      assert.equal(
        receipt.pendingAdmissions.find((entry) => entry.phase === 'environment').executionId,
        controlRef.executionId,
      )
      await fs.writeFile(join(root, 'complete'), '')
      assert.equal(await completed, 0)
      receipt.second = await phase('resume')
      const after = await journal.loadTree(runId)
      receipt.settlements = after.filter((event) => event.kind === 'settled')
      receipt.finalCreates = creates
      receipt.finalDispatchCalls = dispatchCalls
      receipt.finalStarts = starts
      receipt.finalNativeAlive = alive
      receipt.finalDestroys = destroys
      receipt.nativeResult = JSON.parse(await fs.readFile(join(root, 'native-result.json'), 'utf8'))
      assert.equal(receipt.second.status, 'settled')
      assert.equal(receipt.second.resultExists, true)
      assert.equal(receipt.nativeResult.answer, 42)
      assert.equal(creates, 1)
      assert.equal(starts, 1)
      assert.equal(receipt.settlements.length, rootOwner ? 0 : 1)
      if (!rootOwner) assert.equal(receipt.settlements[0].status, 'done')
      const finalBytes = await fs.readFile(join(root, 'spawn-journal.jsonl'))
      assert.ok(finalBytes.subarray(0, committedPrefix.length).equals(committedPrefix))
      assert.deepEqual(
        after.filter((event) => event.kind === 'spawned'),
        before.filter((event) => event.kind === 'spawned'),
      )
      assert.equal(after.filter((event) => event.kind === 'execution-input').length, 1)
      assert.equal(after.filter((event) => event.kind === 'execution-result').length, 1)
      receipt.originalIdentityAndDeadlinePreserved = true
      receipt.committedPrefixPreserved = true
      receipt.passed = true
    }
  } catch (error) {
    receipt.passed = false
    receipt.error = String(error)
    process.exitCode = 1
  } finally {
    if (alive) {
      worker.kill()
      await completed
    }
    server.closeAllConnections()
    await new Promise((close) => server.close(close))
    await fs.writeFile(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2))
  }
  console.log(JSON.stringify(receipt))
}
