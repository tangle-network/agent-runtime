/**
 * MCP for the `pi` harness, at the layer that actually spawns pi.
 *
 * pi ships no MCP of its own — it comes from the `pi-mcp-adapter` extension, which reads the file
 * named by its `--mcp-config` flag. Before this path existed, a profile carrying `mcp` reached pi
 * with nothing mounted and the worker ran tool-less while burning its whole budget hunting for
 * tools that were never there. These tests pin the properties that failure needs:
 *
 *   1. a declared server reaches the exact file pi was told to read, with the canonical body;
 *   2. every worker gets its OWN file — two workers built from ONE seam run concurrently without
 *      colliding, which is the ordinary supervisor case;
 *   3. `--no-extensions` (from `extensions.pi.load`) can never suppress the adapter that makes the
 *      declared servers work — and when this executor adds it, the addition is REPORTED on a
 *      channel a FAILED run still exposes;
 *   4. a missing adapter throws before any file is written and before pi is spawned;
 *   5. a profile with no MCP changes nothing at all;
 *   6. the caller's profile object is never mutated.
 *
 * The fake pi below is deliberately minimal: it records the argv it was launched with and the exact
 * bytes of the file `--mcp-config` named — resolved the same way the real adapter resolves it
 * (`pi-mcp-adapter` `utils.ts:55`, `process.argv.indexOf('--mcp-config')`). That is the only
 * evidence that proves the mount landed where a real pi-mcp-adapter would look. It writes its
 * record under its OWN pid so two concurrent workers cannot overwrite each other's evidence.
 */

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, ValidationError } from '../../src/errors'
import { piExecutor, piSeamKey } from '../../src/runtime/supervise/pi-executor'
import {
  buildPiMcpServers,
  derivePiExtensionArgs,
  mountPiMcpConfig,
  PI_MCP_ADAPTER_ENV,
  PI_MCP_CONFIG_FLAG,
  piMcpAdapterAvailable,
  preparePiMcp,
} from '../../src/runtime/supervise/pi-mcp'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'

const FAKE_PI = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const argv = process.argv.slice(2)
// The real adapter resolves its config off raw argv (pi-mcp-adapter utils.ts:55). Same here.
const flagIndex = argv.indexOf('--mcp-config')
let mcp = null
if (flagIndex >= 0 && flagIndex + 1 < argv.length) {
  try {
    mcp = fs.readFileSync(argv[flagIndex + 1], 'utf8')
  } catch (err) {
    mcp = 'UNREADABLE:' + err.code
  }
}
if (process.env.PI_LOG_DIR) {
  fs.writeFileSync(
    path.join(process.env.PI_LOG_DIR, process.pid + '.json'),
    JSON.stringify({ argv, mcp }),
  )
}
const holdMs = Number(process.env.PI_HOLD_MS || 0)
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const answer = (id) => {
  emit({ id, type: 'response', command: 'prompt', success: true })
  emit({ type: 'agent_start' })
  emit({ type: 'turn_start' })
  const final = {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    stopReason: 'stop',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
  }
  emit({ type: 'message_end', message: final })
  emit({ type: 'turn_end', message: final, toolResults: [] })
  emit({ type: 'agent_end', messages: [final], willRetry: false })
  emit({ type: 'agent_settled' })
}
let buf = ''
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8')
  for (;;) {
    const nl = buf.indexOf('\\n')
    if (nl < 0) break
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let cmd
    try { cmd = JSON.parse(line) } catch { continue }
    if (cmd.type !== 'prompt') continue
    // A hold makes two concurrent workers genuinely overlap: neither can settle before the other
    // has spawned, read its own config, and recorded it.
    if (holdMs > 0) setTimeout(() => answer(cmd.id), holdMs)
    else answer(cmd.id)
  }
})
`

let root: string
let fakePi: string
/** A pi agent home with `pi-mcp-adapter` (and one unrelated extension) genuinely installed. */
let agentDirWithAdapter: string
/** A pi agent home with nothing installed — the "adapter missing" machine. */
let agentDirBare: string
let adapterEntry: string
let memoryEntry: string

const originalAgentDir = process.env.PI_CODING_AGENT_DIR
const originalOverride = process.env[PI_MCP_ADAPTER_ENV]

async function installFakeExtension(agentDir: string, name: string): Promise<string> {
  const packageDir = join(agentDir, 'npm', 'node_modules', name)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name, main: 'index.ts' }))
  await writeFile(join(packageDir, 'index.ts'), 'export default {}\n')
  return join(packageDir, 'index.ts')
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-mcp-'))
  fakePi = join(root, 'fake-pi.cjs')
  await writeFile(fakePi, FAKE_PI, { mode: 0o755 })

  agentDirWithAdapter = join(root, 'agent-with-adapter')
  adapterEntry = await installFakeExtension(agentDirWithAdapter, 'pi-mcp-adapter')
  memoryEntry = await installFakeExtension(agentDirWithAdapter, 'pi-memory')

  agentDirBare = join(root, 'agent-bare')
  await mkdir(join(agentDirBare, 'npm', 'node_modules'), { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

afterEach(() => {
  restoreEnv('PI_CODING_AGENT_DIR', originalAgentDir)
  restoreEnv(PI_MCP_ADAPTER_ENV, originalOverride)
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function withAdapter(): void {
  process.env.PI_CODING_AGENT_DIR = agentDirWithAdapter
  delete process.env[PI_MCP_ADAPTER_ENV]
}

function withoutAdapter(): void {
  process.env.PI_CODING_AGENT_DIR = agentDirBare
  delete process.env[PI_MCP_ADAPTER_ENV]
}

let caseCounter = 0
async function freshCwd(): Promise<string> {
  caseCounter += 1
  const cwd = join(root, `cwd-${caseCounter}`)
  await mkdir(cwd, { recursive: true })
  return cwd
}

/** Config directories this module creates inside a worker cwd, so a leak is visible. */
function mcpDirsIn(cwd: string): string[] {
  return readdirSync(cwd).filter((name) => name.startsWith('.pi-mcp-'))
}

interface PiRunRecord {
  argv: string[]
  /** Bytes of the file `--mcp-config` named, or null when no such flag was passed. */
  mcp: string | null
}

/** Everything the fake pi processes recorded during one test, newest-irrelevant (keyed by pid). */
async function readRunRecords(logDir: string): Promise<PiRunRecord[]> {
  const names = existsSync(logDir) ? readdirSync(logDir) : []
  const records: PiRunRecord[] = []
  for (const name of names) {
    records.push(JSON.parse(await readFile(join(logDir, name), 'utf8')) as PiRunRecord)
  }
  return records
}

function configPathOf(argv: ReadonlyArray<string>): string | undefined {
  const index = argv.indexOf(PI_MCP_CONFIG_FLAG)
  return index >= 0 ? argv[index + 1] : undefined
}

/** A run: one pi launch in `cwd` with `profile`, returning everything pi observed. */
async function runPi(
  profile: AgentProfile,
  cwd: string,
): Promise<{
  argv: string[] | undefined
  mcpConfig: string | null | undefined
  out: unknown
  derived: ReadonlyArray<string> | undefined
  error: Error | undefined
}> {
  const logDir = join(cwd, 'pi-logs')
  await mkdir(logDir, { recursive: true })
  const ctx: ExecutorContext = {
    signal: new AbortController().signal,
    seams: { [piSeamKey]: { bin: fakePi, cwd, env: { PI_LOG_DIR: logDir } } },
  }
  const spec: AgentSpec = { profile, harness: null }
  const executor = piExecutor(spec, ctx)
  let error: Error | undefined
  try {
    for await (const _ of executor.execute(
      'do the work',
      ctx.signal,
    ) as AsyncIterable<UsageEvent>) {
      // drain
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  }
  await executor.teardown('brutalKill')
  const records = await readRunRecords(logDir)
  const record = records[0]
  return {
    argv: record?.argv,
    mcpConfig: record?.mcp,
    out: error ? undefined : executor.resultArtifact().out,
    derived: executor.progress?.()?.derived,
    error,
  }
}

describe('buildPiMcpServers — the canonical body pi-mcp-adapter reads', () => {
  it('emits stdio and remote entries in the shape cli-bridge already proved, dropping disabled', () => {
    const servers = buildPiMcpServers({
      coordination: { transport: 'http', url: 'http://127.0.0.1:7331/mcp' },
      local: {
        command: 'node',
        args: [{ kind: 'public', value: 'server.mjs' }],
        env: { LOG: { kind: 'public', value: 'debug' } },
        cwd: '/srv/tools',
      },
      off: { enabled: false },
      hollow: { command: '' } as never,
    })

    expect(servers).toEqual({
      coordination: { type: 'http', url: 'http://127.0.0.1:7331/mcp', directTools: true },
      local: {
        command: 'node',
        args: ['server.mjs'],
        env: { LOG: 'debug' },
        cwd: '/srv/tools',
        directTools: true,
      },
    })
  })

  it('is byte-identical to cli-bridge buildCanonicalMcpServers on the shared field set', () => {
    // cli-bridge `profile-support.ts:253` emits stdio as `{command, args, env, timeout}` and remote
    // as `{type, url, headers, timeout}`, in that key order. `AgentProfileMcpServer` has no
    // `timeout`, so for any server BOTH input types can express, the bytes match exactly — key
    // order included, because this file is read by two different writers — EXCEPT for the trailing
    // `directTools`, which this writer adds deliberately and cli-bridge does not yet. It is pinned
    // as the last key of every entry so the divergence is exactly one field, visible in the bytes.
    const bytes = JSON.stringify(
      buildPiMcpServers({
        local: {
          transport: 'stdio',
          command: 'node',
          args: [{ kind: 'public', value: 'server.mjs' }],
          env: { LOG: { kind: 'public', value: 'debug' } },
        },
        remote: { transport: 'http', url: 'https://api.example/mcp' },
        legacy: {
          transport: 'sse',
          url: 'https://api.example/sse',
          headers: { 'X-Tenant': { kind: 'public', value: 'acme' } },
        },
      }),
    )

    expect(bytes).toBe(
      '{"local":{"command":"node","args":["server.mjs"],"env":{"LOG":"debug"},"directTools":true},' +
        '"remote":{"type":"http","url":"https://api.example/mcp","directTools":true},' +
        '"legacy":{"type":"sse","url":"https://api.example/sse","headers":{"X-Tenant":"acme"},' +
        '"directTools":true}}',
    )

    // Strip the one deliberate addition and cli-bridge parity is exact again.
    const withoutDirect = bytes.replaceAll(',"directTools":true', '')
    expect(withoutDirect).toBe(
      '{"local":{"command":"node","args":["server.mjs"],"env":{"LOG":"debug"}},' +
        '"remote":{"type":"http","url":"https://api.example/mcp"},' +
        '"legacy":{"type":"sse","url":"https://api.example/sse","headers":{"X-Tenant":"acme"}}}',
    )
  })

  it('accepts `sse` and round-trips the declared transport verbatim', () => {
    // The adapter connects a URL server by probing StreamableHTTP and falling back to
    // SSEClientTransport when the probe fails (pi-mcp-adapter server-manager.ts:765), so an
    // SSE-only endpoint does connect. Refusing it would reject a server pi can actually run.
    expect(buildPiMcpServers({ feed: { transport: 'sse', url: 'https://x/sse' } })).toEqual({
      feed: { type: 'sse', url: 'https://x/sse', directTools: true },
    })
  })

  it('treats a url with no declared transport as http rather than dropping it', () => {
    // `transport` is optional on AgentProfileRemoteMcpServer; a silent drop here is the exact bug
    // this module exists to fix.
    expect(buildPiMcpServers({ remote: { url: 'https://x/mcp' } })).toEqual({
      remote: { type: 'http', url: 'https://x/mcp', directTools: true },
    })
  })

  it('drops an explicit stdio entry that carries no command, exactly as cli-bridge drops it', () => {
    expect(
      buildPiMcpServers({ broken: { transport: 'stdio', url: 'https://x/mcp' } as never }),
    ).toEqual({})
  })

  it('refuses a secret-ref instead of writing a placeholder into the config', () => {
    expect(() =>
      buildPiMcpServers({
        api: {
          transport: 'http',
          url: 'https://api.example/mcp',
          headers: { Authorization: { kind: 'secret-ref', key: 'API_TOKEN', format: 'bearer' } },
        },
      }),
    ).toThrow(ConfigError)
  })
})

describe('piMcpAdapterAvailable — detection, never assumption', () => {
  it('finds an npm-installed adapter, and reports a bare agent home as missing', () => {
    withAdapter()
    expect(piMcpAdapterAvailable()).toBe(true)
    withoutAdapter()
    expect(piMcpAdapterAvailable()).toBe(false)
  })

  it('finds an adapter listed only in settings.json packages', async () => {
    const agentDir = join(root, 'agent-settings-only')
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['npm:pi-mcp-adapter'] }),
    )
    process.env.PI_CODING_AGENT_DIR = agentDir
    delete process.env[PI_MCP_ADAPTER_ENV]
    expect(piMcpAdapterAvailable()).toBe(true)
  })

  it('honors the env override in both directions for vendored installs', () => {
    withoutAdapter()
    process.env[PI_MCP_ADAPTER_ENV] = '1'
    expect(piMcpAdapterAvailable()).toBe(true)
    withAdapter()
    process.env[PI_MCP_ADAPTER_ENV] = '0'
    expect(piMcpAdapterAvailable()).toBe(false)
  })
})

describe('derivePiExtensionArgs — the `--no-extensions` trap', () => {
  it('emits nothing when the profile declares no load list, so pi keeps its own discovery', () => {
    withAdapter()
    expect(derivePiExtensionArgs({}, true)).toEqual({
      args: [],
      entries: [],
      adapterInjected: false,
    })
  })

  it('adds the adapter to a load array that omits it, and reports the addition', () => {
    // THE defect this guards: `--no-extensions` suppresses the settings.json `packages` list too,
    // so `load: ['pi-memory']` next to `mcp` would kill the adapter and mount zero servers even
    // though the adapter is installed.
    withAdapter()
    const derived = derivePiExtensionArgs({ extensions: { pi: { load: ['pi-memory'] } } }, true)

    expect(derived.adapterInjected).toBe(true)
    expect(derived.entries).toEqual([memoryEntry, adapterEntry])
    expect(derived.args).toEqual([
      '--no-extensions',
      '--extension',
      memoryEntry,
      '--extension',
      adapterEntry,
    ])
  })

  it('does not double-add an adapter the profile already listed', () => {
    withAdapter()
    const derived = derivePiExtensionArgs(
      { extensions: { pi: { load: ['pi-mcp-adapter', 'pi-memory'] } } },
      true,
    )
    expect(derived.adapterInjected).toBe(false)
    expect(derived.entries).toEqual([adapterEntry, memoryEntry])
  })

  it('recognizes the adapter given as an absolute path', () => {
    withAdapter()
    const derived = derivePiExtensionArgs({ extensions: { pi: { load: [adapterEntry] } } }, true)
    expect(derived.adapterInjected).toBe(false)
    expect(derived.entries).toEqual([adapterEntry])
  })

  it('keeps `load: []` a clean zero-extension control when no MCP is declared', () => {
    withAdapter()
    expect(derivePiExtensionArgs({ extensions: { pi: { load: [] } } }, false)).toEqual({
      args: ['--no-extensions'],
      entries: [],
      adapterInjected: false,
    })
  })

  it('rejects an unresolvable extension rather than running an ablation arm without it', () => {
    withAdapter()
    expect(() =>
      derivePiExtensionArgs({ extensions: { pi: { load: ['pi-not-installed'] } } }, false),
    ).toThrow(ConfigError)
  })

  it('rejects a blank or non-string load entry instead of silently dropping it', () => {
    withAdapter()
    expect(() => derivePiExtensionArgs({ extensions: { pi: { load: ['  '] } } }, false)).toThrow(
      ValidationError,
    )
    expect(() => derivePiExtensionArgs({ extensions: { pi: { load: [7] } } }, false)).toThrow(
      ValidationError,
    )
  })
})

describe('mountPiMcpConfig — one config file per worker execution', () => {
  it('writes the config OUTSIDE the worker workspace and removes it whole on cleanup', async () => {
    const cwd = await freshCwd()
    const mount = mountPiMcpConfig(
      { coordination: { type: 'http', url: 'http://x/mcp' } },
      { cwd, runId: 'pi-worker-1' },
    )

    expect(mount).not.toBeNull()
    expect(mount?.serverNames).toEqual(['coordination'])
    // `--mcp-config` carries an absolute path, so the file never needs to sit in the workspace —
    // and a scratch file the worker did not create is one it may commit, diff, or clean.
    expect(mount?.configPath.startsWith(cwd)).toBe(false)
    expect(mount?.configPath).toContain('pi-worker-1')
    expect(JSON.parse(await readFile(mount?.configPath as string, 'utf8'))).toEqual({
      mcpServers: { coordination: { type: 'http', url: 'http://x/mcp' } },
    })

    mount?.cleanup()
    expect(existsSync(mount?.configPath as string)).toBe(false)
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('gives two mounts from ONE cwd two different paths instead of refusing the second', async () => {
    // The defect: `PiSeam.cwd` comes from the ExecutorConfig, so EVERY worker the factory builds
    // shares it. A per-cwd config file makes the ordinary supervisor case a collision.
    const cwd = await freshCwd()
    const first = mountPiMcpConfig({ a: { command: 'a' } }, { cwd, runId: 'pi-worker-1' })
    const second = mountPiMcpConfig({ b: { command: 'b' } }, { cwd, runId: 'pi-worker-1' })

    expect(first?.configPath).not.toBe(second?.configPath)
    expect(JSON.parse(await readFile(first?.configPath as string, 'utf8'))).toEqual({
      mcpServers: { a: { command: 'a' } },
    })
    expect(JSON.parse(await readFile(second?.configPath as string, 'utf8'))).toEqual({
      mcpServers: { b: { command: 'b' } },
    })

    first?.cleanup()
    // One worker's cleanup must not touch the other's still-live config.
    expect(existsSync(second?.configPath as string)).toBe(true)
    second?.cleanup()
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('is idempotent, so cleanup on both the throw path and the finally path is safe', async () => {
    const cwd = await freshCwd()
    const mount = mountPiMcpConfig({ a: { command: 'a' } }, { cwd, runId: 'r' })
    mount?.cleanup()
    expect(() => mount?.cleanup()).not.toThrow()
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('uses an OS temp directory — never process.cwd() — when the seam names no cwd', async () => {
    const mount = mountPiMcpConfig({ a: { command: 'a' } }, { runId: 'pi-worker-2' })
    expect(mount?.configPath.startsWith(tmpdir())).toBe(true)
    expect(mount?.configPath.startsWith(process.cwd())).toBe(false)
    expect(existsSync(mount?.configPath as string)).toBe(true)
    mount?.cleanup()
    expect(existsSync(mount?.configPath as string)).toBe(false)
  })

  it('mounts even when the seam names a cwd that does not exist, because the config is not in it', async () => {
    // The config lives in the OS temp directory and reaches pi by `--mcp-config`, so the seam's
    // cwd has no bearing on whether the mount can be written.
    const mount = mountPiMcpConfig(
      { a: { command: 'a' } },
      { cwd: join(root, 'no-such-cwd'), runId: 'r' },
    )
    expect(mount?.configPath.startsWith(tmpdir())).toBe(true)
    mount?.cleanup()
  })

  it('returns null for an empty server set so the no-MCP path writes nothing', async () => {
    const cwd = await freshCwd()
    expect(mountPiMcpConfig({}, { cwd, runId: 'r' })).toBeNull()
    expect(mcpDirsIn(cwd)).toEqual([])
  })
})

describe('preparePiMcp — fail closed before anything is written', () => {
  it('throws with the adapter name, both lookup locations, and the install command', async () => {
    withoutAdapter()
    const cwd = await freshCwd()
    let caught: Error | undefined
    try {
      preparePiMcp(
        { mcp: { coordination: { transport: 'http', url: 'http://x/mcp' } } },
        {
          cwd,
          runId: 'r',
        },
      )
    } catch (err) {
      caught = err as Error
    }

    expect(caught).toBeInstanceOf(ConfigError)
    expect(caught?.message).toContain('pi-mcp-adapter')
    expect(caught?.message).toContain(join(agentDirBare, 'npm', 'node_modules', 'pi-mcp-adapter'))
    expect(caught?.message).toContain(join(agentDirBare, 'settings.json'))
    expect(caught?.message).toContain('pi install npm:pi-mcp-adapter')
    // Fail-closed means nothing was written on the way out.
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('does not trip the adapter gate on a block of disabled servers', async () => {
    withoutAdapter()
    const cwd = await freshCwd()
    const prepared = preparePiMcp({ mcp: { off: { enabled: false } } }, { cwd, runId: 'r' })
    expect(prepared).toEqual({ args: [], mount: null, receipt: undefined })
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('emits --mcp-config after the extension flags, pointing at the mounted file', async () => {
    withAdapter()
    const cwd = await freshCwd()
    const prepared = preparePiMcp(
      {
        mcp: { coordination: { transport: 'http', url: 'http://x/mcp' } },
        extensions: { pi: { load: ['pi-memory'] } },
      },
      { cwd, runId: 'r' },
    )

    expect(prepared.args).toEqual([
      '--no-extensions',
      '--extension',
      memoryEntry,
      '--extension',
      adapterEntry,
      '--mcp-config',
      prepared.mount?.configPath,
    ])
    expect(prepared.receipt?.configPath).toBe(prepared.mount?.configPath)
    prepared.mount?.cleanup()
  })

  it('never mutates the caller`s profile object', async () => {
    // The adapter injection and the mount are DERIVED state. A profile that came back changed
    // would silently rewrite the caller's own arm definition — an ablation arm that mutates the
    // thing it is ablating measures nothing.
    withAdapter()
    const cwd = await freshCwd()
    const profile: AgentProfile = {
      name: 'ablation-arm',
      mcp: {
        coordination: { transport: 'http', url: 'http://x/mcp' },
        off: { enabled: false },
      },
      extensions: { pi: { load: ['pi-memory'] } },
    }
    const before = structuredClone(profile)
    deepFreeze(profile)

    const prepared = preparePiMcp(profile, { cwd, runId: 'r' })
    prepared.mount?.cleanup()

    expect(prepared.receipt?.adapterInjected).toBe(true)
    expect(profile).toEqual(before)
    // The load array specifically: the adapter was appended to what pi received, not to this list.
    expect(profile.extensions?.pi?.load).toEqual(['pi-memory'])
  })
})

/** Freeze deeply, so an attempted mutation THROWS in strict mode rather than being compared away. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

describe('piExecutor — a profile`s MCP servers reach the real pi process', () => {
  it('mounts the declared servers where pi-mcp-adapter looks, and cleans up after', async () => {
    withAdapter()
    const cwd = await freshCwd()
    const run = await runPi(
      {
        name: 'worker',
        mcp: { coordination: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
      },
      cwd,
    )

    expect(run.error).toBeUndefined()
    // The bytes are what pi itself read from the path it was told to read at startup.
    expect(JSON.parse(run.mcpConfig ?? '{}')).toEqual({
      mcpServers: {
        coordination: { type: 'http', url: 'http://127.0.0.1:1/mcp', directTools: true },
      },
    })
    const configPath = configPathOf(run.argv ?? [])
    expect(run.out).toMatchObject({
      content: 'done',
      mcp: {
        servers: ['coordination'],
        configPath,
        extensions: [],
        adapterInjected: false,
      },
    })
    // No load array, so pi keeps its own discovery and the adapter auto-loads.
    expect(run.argv).not.toContain('--no-extensions')
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('gives two workers built from ONE seam their own config, concurrently', async () => {
    // The ordinary supervisor case: one ExecutorConfig, one `PiSeam.cwd`, many children. A
    // cwd-discovered config file made this hard-fail; a per-execution file makes it routine.
    withAdapter()
    const cwd = await freshCwd()
    const logDir = join(cwd, 'pi-logs')
    await mkdir(logDir, { recursive: true })
    const ctx: ExecutorContext = {
      signal: new AbortController().signal,
      seams: {
        [piSeamKey]: { bin: fakePi, cwd, env: { PI_LOG_DIR: logDir, PI_HOLD_MS: '150' } },
      },
    }

    // BOTH children carry the SAME profile name — N replicas of one arm is the common shape, and
    // it makes the executor's own `pi-<name>-<Date.now()>` run id identical for two workers built
    // in the same millisecond. Nothing but a per-execution path can separate them.
    const build = (server: string) =>
      piExecutor(
        {
          profile: {
            name: 'worker',
            mcp: { [server]: { transport: 'http', url: `http://127.0.0.1:1/${server}` } },
          },
          harness: null,
        } satisfies AgentSpec,
        ctx,
      )

    const alpha = build('tools-alpha')
    const beta = build('tools-beta')
    const drain = async (e: ReturnType<typeof build>): Promise<void> => {
      for await (const _ of e.execute('do the work', ctx.signal) as AsyncIterable<UsageEvent>) {
        // drain
      }
    }
    await Promise.all([drain(alpha), drain(beta)])
    await Promise.all([alpha.teardown('brutalKill'), beta.teardown('brutalKill')])

    const alphaOut = alpha.resultArtifact().out as { mcp?: { configPath: string } }
    const betaOut = beta.resultArtifact().out as { mcp?: { configPath: string } }
    // Two workers, two configs. Same cwd, no collision, no refusal.
    expect(alphaOut.mcp?.configPath).toBeDefined()
    expect(betaOut.mcp?.configPath).toBeDefined()
    expect(alphaOut.mcp?.configPath).not.toBe(betaOut.mcp?.configPath)

    const records = await readRunRecords(logDir)
    expect(records).toHaveLength(2)
    const mounted = records
      .map((r) => ({
        configPath: configPathOf(r.argv),
        servers: Object.keys(
          (JSON.parse(r.mcp ?? '{}') as { mcpServers?: Record<string, unknown> }).mcpServers ?? {},
        ),
      }))
      .sort((l, r) => (l.servers[0] ?? '').localeCompare(r.servers[0] ?? ''))
    // Each pi process read ITS OWN file and saw only its own server.
    expect(mounted.map((m) => m.servers)).toEqual([['tools-alpha'], ['tools-beta']])
    expect(mounted[0]?.configPath).not.toBe(mounted[1]?.configPath)
    expect(new Set([mounted[0]?.configPath, mounted[1]?.configPath])).toEqual(
      new Set([alphaOut.mcp?.configPath, betaOut.mcp?.configPath]),
    )
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('keeps `--no-extensions` from suppressing the adapter, and RECORDS the addition', async () => {
    withAdapter()
    const cwd = await freshCwd()
    const run = await runPi(
      {
        name: 'ablation-arm',
        mcp: { coordination: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
        extensions: { pi: { load: ['pi-memory'] } },
      },
      cwd,
    )

    expect(run.error).toBeUndefined()
    const configPath = configPathOf(run.argv ?? [])
    expect(run.argv).toEqual([
      '--mode',
      'rpc',
      '--no-extensions',
      '--extension',
      memoryEntry,
      '--extension',
      adapterEntry,
      '--mcp-config',
      configPath,
    ])
    // The profile said `['pi-memory']`; pi got two extensions. That difference is on the receipt.
    expect(run.out).toMatchObject({
      mcp: { adapterInjected: true, extensions: [memoryEntry, adapterEntry] },
    })
  })

  it('reports the adapter injection on the progress channel even when the run FAILS', async () => {
    // `resultArtifact()` throws until the stream drains, so a run that dies after the injection
    // could never report it. `progress().derived` is the channel that still answers.
    withAdapter()
    const cwd = await freshCwd()
    const ctx: ExecutorContext = {
      signal: new AbortController().signal,
      // A binary that does not exist: pi emits `error` and the stream throws.
      seams: { [piSeamKey]: { bin: join(root, 'no-such-pi'), cwd, turnTimeoutMs: 2_000 } },
    }
    const executor = piExecutor(
      {
        profile: {
          name: 'doomed',
          mcp: { coordination: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
          extensions: { pi: { load: ['pi-memory'] } },
        },
        harness: null,
      } satisfies AgentSpec,
      ctx,
    )

    await expect(async () => {
      for await (const _ of executor.execute('work', ctx.signal) as AsyncIterable<UsageEvent>) {
        // drain
      }
    }).rejects.toThrow()

    // The artifact channel cannot answer at all.
    expect(() => executor.resultArtifact()).toThrow(ValidationError)
    const derived = executor.progress?.()?.derived ?? []
    expect(derived.some((line) => line.includes('--mcp-config'))).toBe(true)
    expect(derived.some((line) => line.includes('pi-mcp-adapter'))).toBe(true)
    // And the workspace is clean despite the failure.
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('throws before spawning pi when the adapter is not installed', async () => {
    withoutAdapter()
    const cwd = await freshCwd()
    const run = await runPi(
      {
        name: 'worker',
        mcp: { coordination: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
      },
      cwd,
    )

    expect(run.error).toBeInstanceOf(ConfigError)
    expect(run.error?.message).toContain('pi install npm:pi-mcp-adapter')
    // Never spawned: no record at all, and no config left in the workspace.
    expect(run.argv).toBeUndefined()
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('is a pure no-op for a profile with no MCP — no file, no flag, no receipt', async () => {
    // The regression that matters most: this path must be indistinguishable from before the fix.
    withoutAdapter()
    const cwd = await freshCwd()
    const run = await runPi({ name: 'worker' }, cwd)

    expect(run.error).toBeUndefined()
    expect(run.mcpConfig).toBeNull()
    expect(run.argv).toEqual(['--mode', 'rpc'])
    expect(run.out).toEqual({ content: 'done', turns: 1 })
    expect(run.derived).toBeUndefined()
    expect(mcpDirsIn(cwd)).toEqual([])
  })

  it('removes the config even when the run fails mid-flight', async () => {
    withAdapter()
    const cwd = await freshCwd()
    const ctx: ExecutorContext = {
      signal: new AbortController().signal,
      seams: {
        [piSeamKey]: {
          // A binary that does not exist: pi emits `error`, the stream throws, and the `finally`
          // still owes the workspace its cleanup.
          bin: join(root, 'no-such-pi'),
          cwd,
          turnTimeoutMs: 2_000,
        },
      },
    }
    const spec: AgentSpec = {
      profile: { mcp: { coordination: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } } },
      harness: null,
    }
    const executor = piExecutor(spec, ctx)
    await expect(async () => {
      for await (const _ of executor.execute('work', ctx.signal) as AsyncIterable<UsageEvent>) {
        // drain
      }
    }).rejects.toThrow()

    expect(mcpDirsIn(cwd)).toEqual([])
  })
})
