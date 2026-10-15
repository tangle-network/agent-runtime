/**
 * `continuation.session` on a retained provider root.
 *
 * `native` sends every re-entry into the harness session that received the first turn. `fresh`
 * starts a new harness session for every re-entry, in the same environment: the files the root
 * wrote are still there, and its earlier turns are not, so the turn's input is Runtime's full
 * re-entry task. The `sla` preset compiles to the fresh form, which is the property its advisor
 * depends on: every epoch's model input holds the coordinator's projection and no earlier turn.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { compileSearchSpec, searchPresets } from '../../src/runtime/supervise/search-spec'
import { type SuperviseOptions, supervise } from '../../src/runtime/supervise/supervise'
import { testContinuation, testContinuationProfile } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

interface RootTurn {
  readonly environmentId: string
  readonly sessionId: string | undefined
  readonly text: string
  /** Whether the environment still held the file the first turn wrote. */
  readonly notes: string | undefined
}

const answer = 'ROOT: both children received'

/**
 * Run a retained root over the durable test provider. Its first turn writes `notes.md` into its
 * environment and assigns child `a`; the turn after `a` settles assigns child `b`; the turn after
 * `b` settles submits. Each child submits on its first turn.
 */
async function retainedRoot(
  runId: string,
  call: (run: {
    readonly root: AgentProfile
    readonly child: AgentProfile
    readonly options: Omit<SuperviseOptions, 'budget' | 'deliverable' | 'continuation'>
  }) => Promise<unknown>,
): Promise<{ readonly turns: ReadonlyArray<RootTurn>; readonly result: unknown }> {
  const directory = await mkdtemp(join(tmpdir(), 'fresh-session-'))
  directories.push(directory)
  const context = createFileRunContext(join(directory, 'run'))
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const roles = new Map<string, string>()
  const files = new Map<string, Map<string, string>>()
  const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
  const turns: RootTurn[] = []
  const settled = (child: string) => `\\"settled\\":\\"${runId}:${child}\\",\\"status\\":\\"done\\"`
  const child = testAgentProfile('child', {
    harness: 'claude-code',
    tools: runtimeToolDeclarations('submit_result'),
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    async create(input) {
      const created = await base.create(input)
      const role = typeof input.profile === 'string' ? input.profile : input.profile.name
      roles.set(created.id, role)
      const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
      if (attachment?.transport !== 'http') throw new Error('missing coordination attachment')
      const coordinate = async (name: string, args: unknown) => {
        const response = await fetch(attachment.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.env?.AGENT_RUNTIME_COORDINATION_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: name,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
        const body = await response.json()
        if (!response.ok || body.error || body.result?.isError) {
          throw new Error(JSON.stringify(body))
        }
        return JSON.parse(body.result.content[0].text)
      }
      const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        async dispatch(turn) {
          const result = await environment.dispatch!(turn)
          if (role !== 'root') {
            await coordinate('submit_result', { result: { answer: 'CHILD: ready' } })
            return result
          }
          const text = JSON.stringify(turn)
          turns.push({
            environmentId: environment.id,
            sessionId: turn.sessionId,
            text,
            notes: files.get(environment.id)?.get('notes.md'),
          })
          if (turns.length === 1) {
            files.set(environment.id, new Map([['notes.md', 'epoch 1: child a assigned']]))
            await coordinate('spawn_worker', { profile: 'child', task: 'Report a.' })
          } else if (text.includes(settled('s1'))) {
            await coordinate('submit_result', { result: { answer } })
          } else if (text.includes(settled('s0'))) {
            await coordinate('spawn_worker', { profile: 'child', task: 'Report b.' })
          }
          return result
        },
      })
      wrappers.set(created.id, wrap)
      return wrap(created)
    },
    async get(id) {
      const environment = await base.get!(id)
      const wrap = wrappers.get(id)
      return environment && wrap ? wrap(environment) : environment
    },
  }
  const backend = { backend: 'provider' as const, provider }
  const result = await call({
    root: testAgentProfile('root', {
      harness: 'claude-code',
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    }),
    child,
    options: {
      runId,
      runDir: join(directory, 'run'),
      journal: context.journal,
      blobs: context.blobs,
      backend,
      driverBackend: backend,
      perWorker: { maxIterations: 6, maxTokens: 100 },
      driverRetry: { enabled: false },
      retainedAtSettlement: 'release',
      teardownConfirmMs: 0,
      wake: { debounceMs: 0, deadlineWarningMs: 0 },
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
      },
    },
  })
  return { turns, result }
}

const budget = { maxIterations: 40, maxTokens: 2_000, deadlineMs: 30_000 }
const deliverable = {
  describe: 'The root reports both children.',
  check: (out: unknown) => (out as { answer?: string } | null)?.answer === answer,
}

function directRun(runId: string, session: 'native' | 'fresh') {
  return retainedRoot(runId, ({ root, child, options }) =>
    supervise(root, 'Assign a, then b, then report.', {
      ...options,
      budget,
      deliverable,
      continuation: testContinuation({ session }),
      registry: {
        profiles: { resolve: (name) => (name === 'child' ? { profile: child } : undefined), names: () => ['child'] },
      },
    }),
  )
}

describe('continuation.session on a retained environment', () => {
  it('native continues one harness session across every re-entry', { timeout: 40_000 }, async () => {
    const { turns, result } = await directRun('session-native', 'native')
    expect(result).toMatchObject({ kind: 'winner', out: { answer } })
    expect(turns).toHaveLength(3)
    expect(new Set(turns.map((turn) => turn.environmentId)).size).toBe(1)
    expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
    // A continued session already holds the run, so a wake is sent as what happened alone.
    for (const turn of turns.slice(1)) {
      expect(turn.notes).toBe('epoch 1: child a assigned')
      expect(turn.text).not.toContain('## Run state, from the coordinator')
    }
  })

  it('fresh starts a new session per re-entry and keeps the workspace files', { timeout: 40_000 }, async () => {
    const { turns, result } = await directRun('session-fresh', 'fresh')
    expect(result).toMatchObject({ kind: 'winner', out: { answer } })
    expect(turns).toHaveLength(3)
    expect(new Set(turns.map((turn) => turn.environmentId)).size).toBe(1)
    expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(3)
    for (const turn of turns.slice(1)) {
      // Same environment, same files; a new conversation told the whole run.
      expect(turn.notes).toBe('epoch 1: child a assigned')
      expect(turn.text).toContain('You run in the same environment as before')
      expect(turn.text).toContain('your files are where you left them')
      expect(turn.text).toContain('## Objective')
      expect(turn.text).toContain('Assign a, then b, then report.')
      expect(turn.text).toContain('## Run state, from the coordinator')
    }
  })
})

describe("a caller's drive harness under continuation.session", () => {
  async function composedReentry(session: 'native' | 'fresh'): Promise<string> {
    const composed: string[] = []
    const sessions: Array<string | undefined> = []
    const result = await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('submit_result') }),
      'Deliver the word done.',
      {
        budget: { maxIterations: 50, maxTokens: 10_000 },
        makeLeafAgent: () => {
          throw new Error('this root spawns no workers')
        },
        deliverable: { describe: 'The word done.', check: (out) => out === 'done' },
        continuation: testContinuation({ session }),
        driveHarness: async ({ coordinationMcpUrl, reentry, session: told }) => {
          sessions.push(told)
          if (reentry === undefined) return
          // The harness claims the strongest continuity it could.
          composed.push(reentry.compose({ session: 'continued', environment: 'same', workspace: 'kept' }))
          await fetch(coordinationMcpUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'submit_result', arguments: { result: 'done' } },
            }),
          })
        },
      },
    )
    expect(result.kind).toBe('winner')
    expect(sessions).toEqual([session, session])
    expect(composed).toHaveLength(1)
    return composed[0]!
  }

  it('is told the session on every drive, and fresh always composes the full re-entry task', async () => {
    expect(await composedReentry('native')).not.toContain('## Run state, from the coordinator')
    const fresh = await composedReentry('fresh')
    expect(fresh).toContain('## Objective')
    expect(fresh).toContain('Deliver the word done.')
    expect(fresh).toContain('## Run state, from the coordinator')
  })
})

describe('the sla preset', () => {
  it('gives every advisor epoch the re-entry projection and no earlier turn', { timeout: 40_000 }, async () => {
    const { turns, result } = await retainedRoot('sla-retained', ({ root, child, options }) => {
      const compiled = compileSearchSpec(searchPresets.sla(1), {
        profile: root,
        task: 'Assign a, then b, then report.',
        budget,
        deliverable,
        deadline: Date.now() + 3_600_000,
        continuation: { profile: testContinuationProfile },
        workers: [child],
        options,
      })
      if (compiled.call !== 'supervise') throw new Error('sla compiles to supervise')
      return supervise(compiled.profile, compiled.task, compiled.options)
    })
    expect(result).toMatchObject({ kind: 'winner', out: { answer } })
    expect(turns).toHaveLength(3)
    // Each epoch is the only turn its session ever received.
    const sessions = turns.map((turn) => turn.sessionId)
    expect(new Set(sessions).size).toBe(turns.length)
    expect(new Set(turns.map((turn) => turn.environmentId)).size).toBe(1)
    for (const turn of turns.slice(1)) {
      expect(turn.text).toContain('## Run state, from the coordinator')
      expect(turn.text).toContain('## What woke you')
      expect(turn.notes).toBe('epoch 1: child a assigned')
    }
  })
})
