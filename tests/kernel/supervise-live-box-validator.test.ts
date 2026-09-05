/**
 * The executable score a supervised worker can be graded by — run against its LIVE box.
 *
 * `runAgentRounds` calls `validator.validate(output, ctx)` while the iteration's box is still
 * alive, so `ValidationCtx.box` is the ONE place in this runtime a check can execute commands
 * in the container it is scoring. Every other supervised hook fires after teardown and can only
 * read the artifact the worker left behind.
 *
 * The supervised path could not reach it: no supervise option carried a validator, so the leaf
 * composed `runAgentRounds` without one. These cases pin the wire that closes it, and the three
 * properties that make it safe to leave in:
 *
 *   1. the validator really runs against the SAME box the harness ran in, before it is destroyed,
 *   2. the in-box result DETERMINES the verdict (a failing check settles invalid), so the score is
 *      the container's state and not a constant this test could pass without executing anything,
 *   3. a run that declares no validator is byte-for-byte the run it always was.
 *
 * The box asserts its own liveness: `exec` after `delete` throws rather than returning a value,
 * so "the box was live" is a property of the fixture, not of an assertion that could go stale.
 */

import type {
  CreateSandboxOptions,
  ExecResult,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  createExecutor,
  type SandboxLeafOut,
  snapshotExecutorConfig,
} from '../../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  ExecutorContext,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { Validator } from '../../src/runtime/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// ── The box ───────────────────────────────────────────────────────────────────

/** Everything the fixture observed, in the order it happened. */
interface BoxLog {
  created: string[]
  /** One entry per `exec`, with the box's liveness AT THAT MOMENT. */
  execs: Array<{ boxId: string; command: string; alive: boolean }>
  deleted: string[]
}

/**
 * A box whose filesystem the harness turn writes and `exec` reads back, so a check has real
 * in-container state to grade. `answer` is what the harness leaves in `/work/answer.txt`.
 */
function sandboxClient(answer: string): { client: { create: () => Promise<SandboxInstance> } } & {
  log: BoxLog
} {
  const log: BoxLog = { created: [], execs: [], deleted: [] }
  let seq = 0
  return {
    log,
    client: {
      create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
        const id = `box-${seq++}`
        log.created.push(id)
        let alive = true
        const files = new Map<string, string>()
        const box = {
          id,
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            files.set('/work/answer.txt', answer)
            yield { type: 'result', data: { ok: true, text: 'wrote the answer' } } as SandboxEvent
            yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
          },
          exec(command: string): Promise<ExecResult> {
            // A destroyed container cannot answer. Throwing here is what makes "the validator saw
            // a LIVE box" a fact the fixture enforces rather than a claim the assertions make.
            if (!alive) throw new Error(`exec after teardown: box ${id} is destroyed`)
            log.execs.push({ boxId: id, command, alive })
            const match = /^cat (\S+)$/.exec(command)
            if (!match) throw new Error(`test box: unsupported command ${command}`)
            const path = match[1] as string
            const content = files.get(path)
            return Promise.resolve(
              content === undefined
                ? { exitCode: 1, stdout: '', stderr: `cat: ${path}: No such file` }
                : { exitCode: 0, stdout: content, stderr: '' },
            )
          },
          delete(): Promise<void> {
            alive = false
            log.deleted.push(id)
            return Promise.resolve()
          },
        }
        return Promise.resolve(box as unknown as SandboxInstance)
      },
    },
  }
}

// ── The check ─────────────────────────────────────────────────────────────────

/** What the validator saw on each call. */
interface Observation {
  boxDefined: boolean
  boxId: string | undefined
  iteration: number
  events: number
  exitCode: number
  stdout: string
}

/** Grades the worker by reading `/work/answer.txt` OUT OF THE BOX and comparing to `expected`. */
function inBoxValidator(expected: string): {
  validator: Validator<SandboxLeafOut>
  seen: Observation[]
} {
  const seen: Observation[] = []
  return {
    seen,
    validator: {
      async validate(output, ctx) {
        if (!ctx.box) {
          seen.push({
            boxDefined: false,
            boxId: undefined,
            iteration: ctx.iteration,
            events: output.events.length,
            exitCode: -1,
            stdout: '',
          })
          return { valid: false, score: 0, notes: 'no live box reached the validator' }
        }
        const res = await ctx.box.exec('cat /work/answer.txt')
        seen.push({
          boxDefined: true,
          boxId: ctx.box.id,
          iteration: ctx.iteration,
          events: output.events.length,
          exitCode: res.exitCode,
          stdout: res.stdout,
        })
        const passed = res.exitCode === 0 && res.stdout === expected
        return {
          valid: passed,
          score: passed ? 1 : 0,
          notes: `in-box check read ${JSON.stringify(res.stdout)}`,
        }
      },
    },
  }
}

// ── The supervised run ────────────────────────────────────────────────────────

/** The two driver turns that spawn one worker and wait for it. */
const SPAWN_ONE_WORKER = [
  {
    toolCalls: [
      { name: 'spawn_worker', arguments: { profile: testAgentProfile('worker'), task: 'go' } },
    ],
  },
  { toolCalls: [{ name: 'await_event', arguments: {} }] },
  { content: 'done' },
]

async function superviseWithSeam(
  seam: { sandboxClient: { create: () => Promise<SandboxInstance> } } & {
    validator?: Validator<SandboxLeafOut>
  },
) {
  const journal = new InMemorySpawnJournal()
  const result = await supervise(
    testAgentProfile('root', {
      harness: 'cli-base',
      prompt: { systemPrompt: 'drive the worker' },
      tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
    }),
    'solve it',
    {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'live-box',
      journal,
      backend: { backend: 'sandbox' as const, ...seam },
      brain: scriptedBrain(SPAWN_ONE_WORKER),
    },
  )
  return { result, events: (await journal.loadTree('live-box')) ?? [] }
}

/** The worker's journaled settle — the durable record of what the run decided about it. */
function workerSettle(events: SpawnEvent[]): Extract<SpawnEvent, { kind: 'settled' }> | undefined {
  return events.find((ev): ev is Extract<SpawnEvent, { kind: 'settled' }> => ev.kind === 'settled')
}

describe('a supervised worker can be scored by an executable check against its LIVE box', () => {
  it('runs the check inside the same box the harness ran in, before teardown, and settles on its result', async () => {
    const fake = sandboxClient('42')
    const check = inBoxValidator('42')
    const { result, events } = await superviseWithSeam({
      sandboxClient: fake.client,
      validator: check.validator,
    })

    // 1. The kernel called it, with a LIVE box.
    expect(check.seen).toHaveLength(1)
    const seen = check.seen[0] as Observation
    expect(seen.boxDefined).toBe(true)
    // …the SAME box the worker's harness turn ran in, not some second container.
    expect(fake.log.created).toHaveLength(1)
    expect(seen.boxId).toBe(fake.log.created[0])
    // …and it received the leaf's parsed output alongside the box.
    expect(seen.events).toBeGreaterThan(0)

    // 2. A command really executed in it, while it was alive. The box throws after `delete`, so
    //    reaching this line at all proves the ordering; `alive` records it explicitly.
    expect(fake.log.execs).toEqual([
      { boxId: fake.log.created[0], command: 'cat /work/answer.txt', alive: true },
    ])
    // The box is torn down afterwards — the check is inside the loop, not leaking a live container.
    expect(fake.log.deleted).toEqual(fake.log.created)

    // 3. The verdict the in-box read produced is what the run durably recorded for the worker.
    const settle = workerSettle(events)
    expect(settle?.verdict?.valid).toBe(true)
    expect(settle?.verdict?.score).toBe(1)
    expect(settle?.verdict?.notes).toBe('in-box check read "42"')
    expect(result.kind).toBe('winner')
  })

  it('settles INVALID when the in-box state fails the check, so the verdict is the container and not a constant', async () => {
    // The negative control. Without it every assertion above would still pass for a validator that
    // ignored the box and returned `valid: true`.
    const fake = sandboxClient('not the answer')
    const check = inBoxValidator('42')
    const { events } = await superviseWithSeam({
      sandboxClient: fake.client,
      validator: check.validator,
    })

    expect(check.seen[0]?.stdout).toBe('not the answer')
    const settle = workerSettle(events)
    expect(settle?.verdict?.valid).toBe(false)
    expect(settle?.verdict?.score).toBe(0)
    expect(settle?.verdict?.notes).toBe('in-box check read "not the answer"')

    // A failing check DOWNGRADES the verdict; it does not erase the work. `defaultSelectWinner`
    // falls back to all candidates when none is valid (`run-loop.ts:1184`), so the worker still
    // settles `done` with its artifact and the run keeps the evidence of what the worker produced.
    // A validator that dropped the output would make every failure indistinguishable from a crash.
    expect(settle?.status).toBe('done')
    expect(settle?.outRef).toBeDefined()
    expect(check.seen[0]?.events).toBeGreaterThan(0)
  })

  it('refuses a validator on a STEERABLE worker instead of silently dropping the score', async () => {
    // A steerable worker is a multi-turn session on one box, not a `runAgentRounds` composition,
    // so it has no validator hook at all. Accepting the pair would score nothing and say nothing.
    const fake = sandboxClient('42')
    const spec: AgentSpec = {
      profile: testAgentProfile('leaf', { harness: 'opencode' }),
      harness: 'opencode',
    }
    expect(() =>
      createExecutor({
        backend: 'sandbox',
        sandboxClient: fake.client,
        validator: inBoxValidator('42').validator,
        steering: { maxTurns: 2 },
      })(spec, { signal: new AbortController().signal, seams: {} } as ExecutorContext),
    ).toThrow(/validator is not representable with steering/)
  })
})

describe('a supervised run that declares no validator is unchanged', () => {
  it('executes nothing in the box and keeps the leaf’s own structural settle verdict', async () => {
    const fake = sandboxClient('42')
    const { result, events } = await superviseWithSeam({ sandboxClient: fake.client })

    // Nothing ran in the container: the seam adds no work to a run that asked for none.
    expect(fake.log.execs).toEqual([])
    expect(fake.log.created).toHaveLength(1)
    expect(fake.log.deleted).toEqual(fake.log.created)

    // The verdict is the leaf's structural one — the exact `{ valid: true, score: 1 }` a run
    // before this seam existed recorded, with no notes and no certification.
    const settle = workerSettle(events)
    expect(settle?.verdict).toEqual({ valid: true, score: 1 })
    expect(result.kind).toBe('winner')
  })

  it('carries no validator key through config capture, and keeps the port live by reference when one is set', async () => {
    // `snapshotExecutorConfig` structured-clones its decision data, which cannot clone a method.
    // The validator must therefore survive by IDENTITY, like `sandboxClient`.
    const fake = sandboxClient('42')
    const { validator } = inBoxValidator('42')

    const without = snapshotExecutorConfig({ backend: 'sandbox', sandboxClient: fake.client })
    expect('validator' in without).toBe(false)

    const withOne = snapshotExecutorConfig({
      backend: 'sandbox',
      sandboxClient: fake.client,
      validator,
    })
    expect(withOne.backend).toBe('sandbox')
    if (withOne.backend !== 'sandbox') return
    expect(withOne.validator).toBe(validator)

    // And it still works after capture: the retained reference is the callable object, not a clone.
    const executor = createExecutor({
      backend: 'sandbox',
      sandboxClient: fake.client,
      validator,
    })({ profile: testAgentProfile('leaf', { harness: 'opencode' }), harness: 'opencode' }, {
      signal: new AbortController().signal,
      seams: {},
    } as ExecutorContext)
    for await (const _ of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // the artifact is read after the stream drains
    }
    expect(executor.resultArtifact().verdict?.notes).toBe('in-box check read "42"')
  })
})
