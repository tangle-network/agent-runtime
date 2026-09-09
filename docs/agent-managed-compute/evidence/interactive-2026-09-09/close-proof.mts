import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Sandbox } from '@tangle-network/sandbox'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
const { getApiKey, getBaseUrl, resolveProductProfile } = await import(
  `${process.env.SANDBOX_CLI_SOURCE}/lib/config.ts`
)
const { fetchAuthenticatedAccount } = await import(`${process.env.SANDBOX_CLI_SOURCE}/lib/auth.ts`)
const { startRetainedInteractiveRun, reconnectRetainedInteractiveRun } = await import(
  `${process.env.RUNTIME_SOURCE}/src/runtime/retained-interactive.ts`
)
const { claimRetainedInteractiveControl } = await import(
  `${process.env.RUNTIME_SOURCE}/src/runtime/retained-interactive-control.ts`
)

const name = `runtime-773-no-inference-${Date.now()}`
const admissions = []
const evidence = {
  name,
  sdk: '0.38.2',
  provider: '1.1.6',
  modelPrompts: 0,
  startedAt: new Date().toISOString(),
  steps: [],
}
const profileName = resolveProductProfile('sandbox')
const apiKey = getApiKey(undefined, profileName)
const baseUrl = getBaseUrl(undefined, profileName)
assert.equal(new URL(baseUrl).origin, 'https://sandbox.tangle.tools')
const client = new Sandbox({ apiKey, baseUrl, timeoutMs: 15000 })
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort('180-second proof limit'), 180000)
let environmentId
let terminal
async function record(step, data = {}) {
  evidence.steps.push({ step, ...data })
  console.log(JSON.stringify({ step }))
  await writeFile('./evidence.json', JSON.stringify(evidence, null, 2))
}
const provider = createTangleProvider({
  client,
  defaultBackend: 'codex',
  readyTimeoutMs: 120000,
  mapCreateInput: (input) => ({
    name,
    backend: { type: 'codex', profile: input.profile },
    resources: { cpuCores: 1, memoryMB: 1024, diskGB: 1 },
    egressPolicy: { mode: 'blocked' },
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
    maxLifetimeSeconds: 180,
    idleTimeoutSeconds: 60,
  }),
})
async function main() {
  try {
    const account = await fetchAuthenticatedAccount({ apiKey, baseUrl, timeoutMs: 10000 })
    assert.equal(account.email, process.env.EXPECTED_SANDBOX_EMAIL)
    await record('sandbox-account-verified', {})
    const caps = await provider.capabilities()
    assert.equal(caps.interactiveAgent?.start, true)
    await record('provider-client-capability-confirmed')
    const handle = await startRetainedInteractiveRun({
      provider,
      environment: {
        name,
        idempotencyKey: name,
        profile: { name: 'terminal-conformance-no-inference', harness: 'codex' },
        backend: 'codex',
        resources: { cpu: 1, memoryMb: 1024, diskMb: 1024 },
        egress: { mode: 'blocked' },
      },
      interactiveIdempotencyKey: `${name}-session`,
      cols: 80,
      rows: 24,
      signal: controller.signal,
      onAdmission: async (admission) => {
        admissions.push({
          phase: admission.phase,
          ...(admission.environmentId ? { environmentId: admission.environmentId } : {}),
        })
        if (admission.phase === 'interactive_environment') environmentId = admission.environmentId
        await writeFile('./admissions.json', JSON.stringify(admissions, null, 2))
        await record('admission', {
          phase: admission.phase,
          ...(environmentId ? { environmentId } : {}),
        })
      },
    })
    environmentId = handle.ref.environmentId ?? handle.ref.run.environmentId
    await record('interactive-started', { environmentId, ref: handle.ref })
    const control = await claimRetainedInteractiveControl({
      handle,
      holderId: name,
      signal: controller.signal,
    })
    terminal = await handle.attach({ control, cols: 80, rows: 24 }, { signal: controller.signal })
    const frames = []
    const readerCtl = new AbortController()
    const reader = (async () => {
      try {
        for await (const event of terminal.events({ signal: readerCtl.signal })) {
          if (event.type === 'output')
            frames.push({
              seq: event.seq,
              digest: createHash('sha256').update(event.data).digest('hex'),
            })
        }
      } catch (error) {
        if (!readerCtl.signal.aborted) throw error
      }
    })()
    await delay(1000)
    await terminal.resize({ cols: 100, rows: 30 }, { signal: controller.signal })
    await terminal.resize({ cols: 120, rows: 40 }, { signal: controller.signal })
    await terminal.input({ data: '/help\r' }, { signal: controller.signal })
    await delay(1500)
    const detached = await terminal.detach({ signal: controller.signal })
    readerCtl.abort()
    await reader
    assert.equal(detached.status, 'detached')
    assert.equal((await handle.status()).state, 'running')
    await record('detached-process-running', { outputFrames: frames.length })
    const recovered = await reconnectRetainedInteractiveRun({
      provider,
      ref: handle.ref,
      signal: controller.signal,
    })
    assert.ok(recovered)
    const nextControl = await claimRetainedInteractiveControl({
      handle: recovered,
      holderId: `${name}-reconnect`,
      signal: controller.signal,
    })
    terminal = await recovered.attach(
      { control: nextControl, cols: 120, rows: 40 },
      { signal: controller.signal },
    )
    const replay = []
    const replayCtl = new AbortController()
    const replayTimer = setTimeout(() => replayCtl.abort(), 2000)
    try {
      for await (const event of terminal.events({ signal: replayCtl.signal })) {
        if (event.type === 'output')
          replay.push({
            seq: event.seq,
            digest: createHash('sha256').update(event.data).digest('hex'),
          })
      }
    } catch (error) {
      if (!replayCtl.signal.aborted) throw error
    } finally {
      clearTimeout(replayTimer)
    }
    assert.ok(frames.length > 0)
    assert.ok(replay.length > 0)
    for (let i = 1; i < replay.length; i++) assert.ok(replay[i].seq > replay[i - 1].seq)
    const prior = new Map(frames.map((frame) => [frame.seq, frame.digest]))
    for (const frame of replay)
      if (prior.has(frame.seq)) assert.equal(prior.get(frame.seq), frame.digest)
    await record('reconnected-ordered-history', {
      firstFrames: frames.length,
      replayFrames: replay.length,
      frames,
      replay,
    })
    await record('terminal-close', {
      acknowledgement: await terminal.close({ signal: controller.signal }),
    })
  } catch (error) {
    await record('failure', { name: error.name, status: error.status ?? error.statusCode })
    if (error.cleanupHandle?.id) environmentId ??= error.cleanupHandle.id
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    if (!environmentId) {
      try {
        const matches = (await client.list({ limit: 100 })).filter((box) => box.name === name)
        if (matches.length === 1) environmentId = matches[0].id
        await record('cleanup-inventory', { matchingSandboxes: matches.length })
      } catch (error) {
        await record('cleanup-inventory-failed', { name: error.name })
      }
    }
    if (environmentId) {
      try {
        const box = await client.get(environmentId)
        if (box) await box.delete()
        let gone = false
        try {
          gone = (await client.get(environmentId)) === null
        } catch (error) {
          if (error.status === 404 || error.statusCode === 404 || error.name === 'NotFoundError')
            gone = true
          else throw error
        }
        await record('cleanup-confirmed', { environmentId, gone })
        assert.ok(gone)
      } catch (error) {
        await record('cleanup-failed', { environmentId, name: error.name })
        process.exitCode = 1
      }
    }
  }
}
main()
