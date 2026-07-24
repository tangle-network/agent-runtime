import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { waitForCapacity, type EndpointCapacityGate } from './capacity.ts'
import {
  installProcessSignalAbort,
  isSecretEnvName,
  run,
  stripAmbientSecretEnv,
  TIMEOUT_RC,
} from './proc.ts'

const dirs: string[] = []
const cleanupPids: number[] = []

afterAll(async () => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The expected path already removed it.
    }
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('run process-group timeout', () => {
  it('does not spawn when the caller signal is already aborted', () => {
    const controller = new AbortController()
    controller.abort(new Error('stop before spawn'))
    expect(() => run(process.execPath, ['-e', 'process.exit(99)'], { signal: controller.signal })).toThrow(
      'stop before spawn',
    )
  })

  it('allows a SIGTERM handler to finish cleanup before returning timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-proc-term-'))
    dirs.push(dir)
    const marker = join(dir, 'cleanup.txt')
    const result = await run(process.execPath, [
      '-e',
      `const fs=require('node:fs'); const marker=process.argv[1]; process.on('SIGTERM',()=>{fs.writeFileSync(marker,'settled'); setTimeout(()=>process.exit(0),25)}); setInterval(()=>{},1000)`,
      marker,
    ], { timeoutMs: 60, killGraceMs: 500 })

    expect(result.code).toBe(TIMEOUT_RC)
    expect(result.timedOut).toBe(true)
    expect(await readFile(marker, 'utf8')).toBe('settled')
  })

  it('force-kills a process group that ignores SIGTERM after the grace period', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-proc-kill-'))
    dirs.push(dir)
    const marker = join(dir, 'should-not-exist.txt')
    const started = Date.now()
    const result = await run(process.execPath, [
      '-e',
      `const fs=require('node:fs'); const marker=process.argv[1]; process.on('SIGTERM',()=>{}); setTimeout(()=>fs.writeFileSync(marker,'escaped'),5000); setInterval(()=>{},1000)`,
      marker,
    ], { timeoutMs: 60, killGraceMs: 80 })

    expect(result.code).toBe(TIMEOUT_RC)
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(2_000)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills a TERM-ignoring grandchild when its direct parent exits on TERM', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'swe-proc-tree-'))
    dirs.push(dir)
    const pidFile = join(dir, 'grandchild.pid')
    const grandchild = `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`
    const parent = [
      `const {spawn}=require('node:child_process')`,
      `const fs=require('node:fs')`,
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'})`,
      `fs.writeFileSync(process.argv[1],String(child.pid))`,
      `process.on('SIGTERM',()=>process.exit(0))`,
      `setInterval(()=>{},1000)`,
    ].join(';')

    const result = await run(process.execPath, ['-e', parent, pidFile], {
      timeoutMs: 100,
      killGraceMs: 50,
    })
    const grandchildPid = Number(await readFile(pidFile, 'utf8'))
    cleanupPids.push(grandchildPid)

    expect(result.code).toBe(TIMEOUT_RC)
    expect(result.timedOut).toBe(true)
    expect(() => process.kill(grandchildPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  })

  it('kills a TERM-ignoring grandchild when its direct parent exits normally', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'swe-proc-normal-exit-tree-'))
    dirs.push(dir)
    const pidFile = join(dir, 'grandchild.pid')
    const grandchild = [
      `const fs=require('node:fs')`,
      `process.on('SIGTERM',()=>{})`,
      `fs.writeFileSync(process.argv[1],String(process.pid))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const parent = [
      `const {spawn}=require('node:child_process')`,
      `const fs=require('node:fs')`,
      `spawn(process.execPath,['-e',${JSON.stringify(grandchild)},process.argv[1]],{stdio:'ignore'})`,
      `const ready=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(ready);process.exit(0)}},5)`,
    ].join(';')

    const result = await run(process.execPath, ['-e', parent, pidFile], { killGraceMs: 50 })
    const grandchildPid = Number(await readFile(pidFile, 'utf8'))
    cleanupPids.push(grandchildPid)

    expect(result.code).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
    expect(() => process.kill(grandchildPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  })
})

describe('cooperative process cancellation', () => {
  it('maps the first terminal signal to cancellation and removes its handlers', () => {
    const oldExitCode = process.exitCode
    const beforeInt = new Set(process.rawListeners('SIGINT'))
    const beforeTerm = process.listenerCount('SIGTERM')
    const interrupt = installProcessSignalAbort('test-run')
    const listener = process.rawListeners('SIGINT').find((candidate) => !beforeInt.has(candidate))
    expect(listener).toBeDefined()
    listener?.call(process, 'SIGINT')
    expect(interrupt.signal.aborted).toBe(true)
    expect((interrupt.signal.reason as Error).message).toBe('test-run interrupted by SIGINT')
    expect(interrupt.receivedSignal).toBe('SIGINT')
    expect(process.exitCode).toBe(130)
    interrupt.dispose()
    expect(process.rawListeners('SIGINT').filter((candidate) => !beforeInt.has(candidate))).toHaveLength(0)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
    process.exitCode = oldExitCode
  })

  it('cancels during a capacity retry sleep and never starts another probe', async () => {
    const controller = new AbortController()
    let probes = 0
    const gate: EndpointCapacityGate = {
      name: 'cancel-test',
      probe: async () => {
        probes += 1
        return false
      },
      kOfN: { k: 1, n: 1 },
      waitCeilingMs: 10_000,
      retryDelayMs: 10_000,
    }
    const waiting = waitForCapacity(gate, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort(new Error('capacity cancelled'))
    await expect(waiting).rejects.toThrow('capacity cancelled')
    expect(probes).toBe(1)
  })

  it('runs zero capacity probes when already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled before probing'))
    let probes = 0
    const gate: EndpointCapacityGate = {
      name: 'pre-abort',
      probe: async () => {
        probes += 1
        return true
      },
      kOfN: { k: 1, n: 1 },
      waitCeilingMs: 1_000,
    }
    await expect(waitForCapacity(gate, controller.signal)).rejects.toThrow('cancelled before probing')
    expect(probes).toBe(0)
  })
})

// The hermetic env the verify/judge gate runs the repo's tests under: injected
// inference secrets are stripped so a candidate cannot pass or fail on a leaked key.
describe('stripAmbientSecretEnv — hermetic w.r.t. injected inference secrets', () => {
  it('classifies the secret families and leaves ordinary vars alone', () => {
    for (const name of [
      'TANGLE_API_KEY',
      'INTELLIGENCE_BASE',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'ZAI_API_KEY',
      'SOME_VENDOR_API_KEY',
    ]) {
      expect(isSecretEnvName(name), name).toBe(true)
    }
    for (const name of ['PATH', 'HOME', 'CI', 'npm_config_store_dir', 'TMPDIR', 'NODE_ENV']) {
      expect(isSecretEnvName(name), name).toBe(false)
    }
  })

  it('strips every injected secret from a base env but keeps the rest', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      TANGLE_API_KEY: 'sk-tan-injected',
      INTELLIGENCE_BASE: 'https://intel.example',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-oai',
      npm_config_store_dir: '/tmp/store',
    }
    const clean = stripAmbientSecretEnv(base)
    expect(clean.TANGLE_API_KEY).toBeUndefined()
    expect(clean.INTELLIGENCE_BASE).toBeUndefined()
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined()
    expect(clean.OPENAI_API_KEY).toBeUndefined()
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.HOME).toBe('/home/x')
    expect(clean.npm_config_store_dir).toBe('/tmp/store')
    // Falsification: the raw base still carries the injected key — the gate would decide on it.
    expect(base.TANGLE_API_KEY).toBe('sk-tan-injected')
  })

  it('a subprocess launched under the stripped env cannot read the injected key', async () => {
    const base: NodeJS.ProcessEnv = { ...process.env, TANGLE_API_KEY: 'sk-tan-injected' }
    const read = 'process.stdout.write(process.env.TANGLE_API_KEY ?? "ABSENT")'
    const leaked = await run('node', ['-e', read], { env: base, timeoutMs: 20_000 })
    expect(leaked.stdout).toBe('sk-tan-injected') // without the strip, the child sees the key
    const hermetic = await run('node', ['-e', read], { env: stripAmbientSecretEnv(base), timeoutMs: 20_000 })
    expect(hermetic.stdout).toBe('ABSENT') // under the gate env, the key is gone
  })
})
