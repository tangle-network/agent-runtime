/**
 * Session lineage handed DOWN to a spawned worker (`worker-lineage.ts`).
 *
 * The subprocess case spawns a REAL `node -e` child through the real `cli` backend and asserts on
 * the environment that process observed, and on the event line the runtime appended for it. The
 * unit cases pin the properties that make it safe to leave on: nothing at all without an ambient
 * `TANGLE_RUN_ID`, no operator state created, and a fresh run per worker.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  ExecutorFactory,
  ExecutorRegistry,
  Scope,
} from '../../src/runtime/supervise/types'
import {
  lineageHarness,
  lineageOtelAttributes,
  workerLineage,
} from '../../src/runtime/supervise/worker-lineage'
import { testAgentProfile } from './test-agent-profile'

const PARENT = `run_${'a'.repeat(32)}`
const ROOT = `run_${'b'.repeat(32)}`
const KEYS = [
  'TANGLE_RUN_ID',
  'TANGLE_PARENT_RUN_ID',
  'TANGLE_ROOT_RUN_ID',
  'TANGLE_OPERATOR',
  'TANGLE_PROJECT',
  'TANGLE_ACCOUNT',
  'TANGLE_HARNESS',
  'TANGLE_HOST',
  'TANGLE_CLAUDE_SESSION',
  'LINEAGE_HOME',
  'LINEAGE_HOST',
  'OTEL_RESOURCE_ATTRIBUTES',
] as const

let home: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  home = mkdtempSync(join(tmpdir(), 'lineage-'))
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(home, { recursive: true, force: true })
})

function events(): Array<Record<string, unknown>> {
  return readFileSync(join(home, 'events', 'box-a.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('workerLineage', () => {
  it('stamps nothing and writes nothing when the supervisor carries no run id', () => {
    mkdirSync(join(home, 'events'), { recursive: true })
    const lineage = workerLineage({
      harness: 'codex',
      local: true,
      env: { LINEAGE_HOME: home, LINEAGE_HOST: 'box-a' },
    })
    expect(lineage).toEqual({ env: {}, headers: {} })
    expect(() => readFileSync(join(home, 'events', 'box-a.jsonl'))).toThrow()
  })

  it('mints a fresh child run under the ambient run and records it', () => {
    mkdirSync(join(home, 'events'), { recursive: true })
    const env = {
      TANGLE_RUN_ID: PARENT,
      TANGLE_ROOT_RUN_ID: ROOT,
      TANGLE_OPERATOR: 'op-platform',
      TANGLE_PROJECT: 'agent-runtime',
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=sup,tangle.run.id=stale',
      LINEAGE_HOME: home,
      LINEAGE_HOST: 'Box-A.local',
    }
    const first = workerLineage({
      harness: 'claude-code',
      nodeId: 'run:s0',
      label: 'w',
      local: true,
      env,
    })
    const second = workerLineage({ harness: '/usr/bin/codex', local: false, env })
    expect(first.env.TANGLE_RUN_ID).toMatch(/^run_[0-9a-f]{32}$/)
    expect(first.env.TANGLE_RUN_ID).not.toBe(second.env.TANGLE_RUN_ID)
    expect(first.env).toMatchObject({
      TANGLE_PARENT_RUN_ID: PARENT,
      TANGLE_ROOT_RUN_ID: ROOT,
      TANGLE_EDGE_KIND: 'spawned',
      TANGLE_OPERATOR: 'op-platform',
      TANGLE_PROJECT: 'agent-runtime',
      TANGLE_HARNESS: 'claude-code',
      TANGLE_HOST: 'box-a',
      TANGLE_CLAUDE_SESSION: '',
    })
    expect(second.env.TANGLE_HARNESS).toBe('codex')
    // A remote worker's host is not this machine.
    expect(second.env.TANGLE_HOST).toBeUndefined()
    const otel = first.env.OTEL_RESOURCE_ATTRIBUTES?.split(',') ?? []
    expect(otel).toContain('service.name=sup')
    expect(otel).not.toContain('tangle.run.id=stale')
    expect(otel).toContain(`tangle.run.id=${first.env.TANGLE_RUN_ID}`)
    expect(first.headers['x-tangle-run-id']).toBe(first.env.TANGLE_RUN_ID)
    expect(first.headers['x-tangle-parent-run-id']).toBe(PARENT)

    const lines = events()
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({
      v: 1,
      type: 'node',
      source: 'runtime',
      host: 'box-a',
      run: first.env.TANGLE_RUN_ID,
      parent: PARENT,
      native: 'runtime:run:s0',
      harness: 'claude-code',
    })
    expect(lines[1]).toMatchObject({
      type: 'edge',
      kind: 'spawned',
      src: PARENT,
      dst: first.env.TANGLE_RUN_ID,
    })
    expect(lines[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('never creates operator state that does not exist', () => {
    const lineage = workerLineage({
      harness: 'codex',
      local: true,
      env: { TANGLE_RUN_ID: PARENT, LINEAGE_HOME: home, LINEAGE_HOST: 'box-a' },
    })
    expect(lineage.env.TANGLE_RUN_ID).toBeDefined()
    expect(() => readFileSync(join(home, 'events', 'box-a.jsonl'))).toThrow()
  })

  it('maps binaries and backend types onto the lineage harness names', () => {
    expect(lineageHarness('/home/x/.local/bin/claude')).toBe('claude-code')
    expect(lineageHarness('opencode')).toBe('opencode')
    expect(lineageHarness('node')).toBe('agent-runtime')
    expect(lineageHarness(null)).toBe('agent-runtime')
  })

  it('percent-encodes OTel resource values', () => {
    expect(lineageOtelAttributes('', { TANGLE_PROJECT: 'a,b=c d' })).toBe(
      'tangle.project=a%2Cb%3Dc%20d',
    )
  })
})

const PRINT_LINEAGE_ENV = [
  '-e',
  'process.stdout.write(JSON.stringify({' +
    'run: process.env.TANGLE_RUN_ID ?? null,' +
    'parent: process.env.TANGLE_PARENT_RUN_ID ?? null,' +
    'claudeSession: process.env.TANGLE_CLAUDE_SESSION ?? null}))',
]

function registryOf(factory: ExecutorFactory<unknown>): ExecutorRegistry {
  return withDriverExecutor({
    register(): void {
      throw new Error('registryOf: registration is not part of these cases')
    },
    resolve<Out>() {
      return { succeeded: true as const, value: factory as unknown as ExecutorFactory<Out> }
    },
  })
}

function driver(): Agent<unknown, unknown> {
  const leaf = {
    name: 'w',
    executorSpec: { profile: testAgentProfile('w'), harness: null },
    act: () => Promise.resolve(undefined),
  } as unknown as Agent<unknown, unknown>
  return {
    name: 'root',
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      const res = scope.spawn(leaf, task, {
        budget: { maxIterations: 4, maxTokens: 1_000 },
        label: 'w',
      })
      if (!res.ok) throw new Error(`spawn failed: ${res.reason}`)
      let out: unknown
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        if (s.kind === 'done' && out === undefined) out = s.out
      }
      return out
    },
  }
}

describe('a cli worker process inherits its lineage', () => {
  it('sees a fresh run whose parent is the supervisor run, and the launch is recorded', async () => {
    mkdirSync(join(home, 'events'), { recursive: true })
    process.env.TANGLE_RUN_ID = PARENT
    process.env.TANGLE_CLAUDE_SESSION = 'parent-claude-session'
    process.env.LINEAGE_HOME = home
    process.env.LINEAGE_HOST = 'box-a'
    const result = await createSupervisor<unknown, unknown>().run(driver(), 'task', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: registryOf(
        createExecutor({ backend: 'cli', bin: process.execPath, args: PRINT_LINEAGE_ENV }),
      ),
      maxDepth: 4,
      now: () => 1_000,
    })
    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    const content = (result.out as { content?: unknown }).content
    const seen = JSON.parse(String(content)) as {
      run: string
      parent: string
      claudeSession: string
    }
    expect(seen.parent).toBe(PARENT)
    expect(seen.run).toMatch(/^run_[0-9a-f]{32}$/)
    expect(seen.claudeSession).toBe('')
    const recorded = events().filter((e) => e.type === 'node')
    expect(recorded.map((e) => e.run)).toContain(seen.run)
  })
})
