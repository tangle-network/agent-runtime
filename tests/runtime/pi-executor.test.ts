/**
 * `piExecutor` — pi wrapped behind `Executor`, driven against a FAKE pi that speaks pi 0.83's
 * real RPC wire (`--mode rpc`, JSON lines on stdin/stdout, `AgentEvent` shapes).
 *
 * The point of the wrapper is that it delegates rather than reimplements: a message becomes pi's
 * own `prompt` command with a streaming behavior, teardown becomes `abort`. These tests assert
 * exactly that — the COMMANDS the wrapper sends — plus that pi's tool/turn events become
 * the live progress feed and the shared tool-span currency.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolSpan } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { gateOnDeliverable } from '../../src/runtime/supervise/completion-gate'
import { piExecutor, piSeamKey } from '../../src/runtime/supervise/pi-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  ExecutorContext,
  UsageEvent,
} from '../../src/runtime/supervise/types'

let dir: string
let fakePi: string
let commandLog: string

/**
 * A stand-in for `pi --mode rpc` using Pi 0.83's actual session event order. In particular:
 * user and tool-result messages both emit `message_end`; each model call emits `turn_end`;
 * `agent_end` may be followed by an automatic retry; only `agent_settled` means the session is
 * idle. The scenarios below pin those distinctions instead of approximating the wire.
 */
const FAKE_PI = `#!/usr/bin/env node
const fs = require('node:fs')
const log = process.env.PI_COMMAND_LOG
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const result = (text) => ({ content: [{ type: 'text', text }], details: {} })
const message = (m) => {
  emit({ type: 'message_start', message: m })
  emit({ type: 'message_end', message: m })
}
const pricedUsage = (input, output, cacheRead, cacheWrite, total) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: total / 2, output: total / 2, cacheRead: 0, cacheWrite: 0, total },
})
const freeUsage = (input, output, cacheRead, cacheWrite) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})
const assistant = (text, stopReason, usage, extra = []) => ({
  role: 'assistant',
  content: [...(text ? [{ type: 'text', text }] : []), ...extra],
  stopReason,
  usage,
})
const begin = (prompt) => {
  const user = { role: 'user', content: [{ type: 'text', text: String(prompt) }] }
  emit({ type: 'agent_start' })
  emit({ type: 'turn_start' })
  message(user)
  return user
}
const finish = (messages, willRetry = false) => {
  emit({ type: 'agent_end', messages, willRetry })
  if (!willRetry) emit({ type: 'agent_settled' })
}
const finalTurn = (text, usage = pricedUsage(10, 4, 2, 1, 0.001)) => {
  const final = assistant(text, 'stop', usage)
  emit({ type: 'turn_start' })
  message(final)
  emit({ type: 'turn_end', message: final, toolResults: [] })
  return final
}
let buf = ''
let turn = 0
let pendingAbort
let abortScheduled = false
let exitOnAbort = false
process.stdin.on('data', (c) => {
  buf += c.toString('utf8')
  for (;;) {
    const nl = buf.indexOf('\\n')
    if (nl < 0) break
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let cmd
    try { cmd = JSON.parse(line) } catch { continue }
    fs.appendFileSync(log, JSON.stringify(cmd) + '\\n')

    if (cmd.type === 'abort') {
      emit({ id: cmd.id, type: 'response', command: 'abort', success: true })
      if (exitOnAbort) process.exit(0)
      if (!pendingAbort || abortScheduled) continue
      abortScheduled = true
      const aborted = pendingAbort
      pendingAbort = undefined
      setTimeout(() => {
        message(aborted)
        emit({ type: 'turn_end', message: aborted, toolResults: [] })
        finish([aborted])
      }, 100)
      continue
    }
    if (cmd.type !== 'prompt') continue

    const prompt = String(cmd.message)
    if (prompt.includes('reject at preflight')) {
      emit({
        id: cmd.id,
        type: 'response',
        command: 'prompt',
        success: false,
        error: 'No model selected',
      })
      continue
    }
    emit({ id: cmd.id, type: 'response', command: 'prompt', success: true })
    const target = prompt.includes('right.ts') ? 'right.ts' : 'wrong.ts'
    const myTurn = turn++
    const user = begin(prompt)

    if (prompt.includes('delayed abort receipt')) {
      pendingAbort = assistant(
        'cancelled after billed work',
        'aborted',
        freeUsage(40, 10, 60, 5),
      )
      continue
    }

    if (prompt.includes('exit on abort')) {
      exitOnAbort = true
      continue
    }

    if (prompt.includes('retryable provider error')) {
      const failed = {
        ...assistant('', 'error', freeUsage(0, 0, 0, 0)),
        errorMessage: 'Stream ended without finish_reason',
      }
      message(failed)
      emit({ type: 'turn_end', message: failed, toolResults: [] })
      emit({ type: 'agent_end', messages: [user, failed], willRetry: true })
      emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 25 })
      setTimeout(() => {
        emit({ type: 'agent_start' })
        emit({ type: 'turn_start' })
        const recovered = assistant('recovered', 'stop', pricedUsage(10, 4, 2, 1, 0.001))
        message(recovered)
        emit({ type: 'turn_end', message: recovered, toolResults: [] })
        finish([recovered])
      }, 25)
      continue
    }

    if (prompt.includes('terminal provider error')) {
      const failed = {
        ...assistant('', 'error', freeUsage(0, 0, 0, 0)),
        errorMessage: 'Stream ended without finish_reason',
      }
      message(failed)
      emit({ type: 'turn_end', message: failed, toolResults: [] })
      finish([user, failed])
      continue
    }

    if (prompt.includes('subscription usage')) {
      const final = assistant('subscription result', 'stop', freeUsage(30, 12, 5, 3))
      message(final)
      emit({ type: 'turn_end', message: final, toolResults: [] })
      finish([user, final])
      continue
    }

    const parallel = prompt.includes('parallel tools')
    const emptyFinal = prompt.includes('empty final assistant')
    const calls = parallel
      ? [
          { type: 'toolCall', id: 'read-' + myTurn, name: 'read', arguments: { path: 'alpha.ts' } },
          { type: 'toolCall', id: 'bash-' + myTurn, name: 'bash', arguments: { command: 'pnpm test' } },
        ]
      : [{ type: 'toolCall', id: 'edit-' + myTurn, name: 'edit', arguments: { path: target } }]
    const toolTurn = assistant('working', 'toolUse', pricedUsage(30, 12, 5, 3, 0.002), calls)
    message(toolTurn)

    const toolResults = []
    if (parallel) {
      emit({ type: 'tool_execution_start', toolCallId: 'read-' + myTurn, toolName: 'read', args: { path: 'alpha.ts' } })
      emit({ type: 'tool_execution_start', toolCallId: 'bash-' + myTurn, toolName: 'bash', args: { command: 'pnpm test' } })
      emit({ type: 'tool_execution_end', toolCallId: 'bash-' + myTurn, toolName: 'bash', result: result('tests passed'), isError: false })
      emit({ type: 'tool_execution_end', toolCallId: 'read-' + myTurn, toolName: 'read', result: result('permission denied'), isError: true })
      toolResults.push(
        { role: 'toolResult', toolCallId: 'read-' + myTurn, toolName: 'read', content: result('permission denied').content, isError: true },
        { role: 'toolResult', toolCallId: 'bash-' + myTurn, toolName: 'bash', content: result('tests passed').content, isError: false },
      )
    } else {
      emit({ type: 'tool_execution_start', toolCallId: 'edit-' + myTurn, toolName: 'edit', args: { path: target } })
      const toolText = emptyFinal ? 'TOOL_RESULT_MUST_NOT_BECOME_OUTPUT' : 'updated ' + target
      emit({ type: 'tool_execution_end', toolCallId: 'edit-' + myTurn, toolName: 'edit', result: result(toolText), isError: false })
      toolResults.push({ role: 'toolResult', toolCallId: 'edit-' + myTurn, toolName: 'edit', content: result(toolText).content, isError: false })
    }
    for (const toolResult of toolResults) message(toolResult)
    emit({ type: 'turn_end', message: toolTurn, toolResults })
    const final = finalTurn(emptyFinal ? '' : 'edited ' + target)
    finish([user, toolTurn, ...toolResults, final])
  }
})
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pi-exec-'))
  fakePi = join(dir, 'fake-pi.cjs')
  commandLog = join(dir, 'commands.jsonl')
  await writeFile(fakePi, FAKE_PI, { mode: 0o755 })
  await writeFile(commandLog, '')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The fake is an executable with a `#!/usr/bin/env node` shebang, so it is launched exactly the
 *  way a real `pi` binary is: `<bin> --mode rpc`, with the wrapper owning the flags. */
function piCtx(): ExecutorContext {
  return {
    signal: new AbortController().signal,
    seams: { [piSeamKey]: { bin: fakePi, env: { PI_COMMAND_LOG: commandLog } } },
  }
}

const spec: AgentSpec = {
  profile: { name: 'coder' } as AgentProfile,
  harness: null,
}

async function drain(iter: AsyncIterable<UsageEvent>): Promise<UsageEvent[]> {
  const out: UsageEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

async function captureFailure(iter: AsyncIterable<UsageEvent>): Promise<{
  events: UsageEvent[]
  error: Error | undefined
}> {
  const events: UsageEvent[] = []
  try {
    for await (const event of iter) events.push(event)
    return { events, error: undefined }
  } catch (error) {
    return { events, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

async function readCommands(): Promise<Array<Record<string, unknown>>> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(commandLog, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

async function waitForCommand(
  predicate: (command: Record<string, unknown>) => boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if ((await readCommands()).some(predicate)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for fake Pi command')
}

describe('piExecutor — pi wrapped, not forked', () => {
  it('runs a turn, reports REAL usage off pi events, and exposes live progress + tool spans', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    expect(ex.runtime).toBe('pi')

    const events = await drain(
      ex.execute('make the change', ctx.signal) as AsyncIterable<UsageEvent>,
    )

    // REAL usage only — the numbers the fake pi reported, not a fabricated estimate.
    expect(events.filter((event) => event.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 38, output: 12 },
      { kind: 'tokens', input: 13, output: 4 },
    ])
    expect(events).toContainEqual({ kind: 'cost', usd: 0.002 })
    expect(events).toContainEqual({ kind: 'cost', usd: 0.001 })
    expect(events.filter((e) => e.kind === 'iteration')).toHaveLength(2)

    const progress = ex.progress?.()
    expect(progress?.turns).toBe(2)
    expect(progress?.recentActivity?.some((a) => a.label === 'edit')).toBe(true)

    const spans = (await ex.traceSource?.()?.collect()) as ToolSpan[]
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      toolName: 'edit',
      args: { path: 'wrong.ts' },
      status: 'ok',
      result: { content: [{ type: 'text', text: 'updated wrong.ts' }], details: {} },
    })

    const artifact = ex.resultArtifact()
    expect(String((artifact.out as { content: string }).content)).toContain('edited wrong.ts')
    expect(artifact.spent.tokens).toEqual({ input: 51, output: 16 })
    expect(artifact.spent.usd).toBe(0.003)
    await ex.teardown('brutalKill')
  })

  it('joins parallel Pi 0.83 tool completions to their starts by toolCallId', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    await drain(ex.execute('run parallel tools', ctx.signal) as AsyncIterable<UsageEvent>)

    const spans = (await ex.traceSource?.()?.collect()) as ToolSpan[]
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({
      toolName: 'bash',
      args: { command: 'pnpm test' },
      status: 'ok',
      result: { content: [{ type: 'text', text: 'tests passed' }], details: {} },
    })
    expect(spans[1]).toMatchObject({
      toolName: 'read',
      args: { path: 'alpha.ts' },
      status: 'error',
      error: 'permission denied',
      result: { content: [{ type: 'text', text: 'permission denied' }], details: {} },
    })
    await ex.teardown('brutalKill')
  })

  it('marks subscription-priced Pi usage as unknown instead of known zero', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    const events = await drain(
      ex.execute('subscription usage', ctx.signal) as AsyncIterable<UsageEvent>,
    )

    expect(events.filter((event) => event.kind === 'cost')).toEqual([
      { kind: 'cost', usd: 0, usdKnown: false },
    ])
    expect(ex.resultArtifact().spent).toMatchObject({ usd: 0, usdKnown: false })
    await ex.teardown('brutalKill')
  })

  it('waits for agent_settled so Pi can recover after agent_end requests a retry', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    const events = await drain(
      ex.execute('retryable provider error', ctx.signal) as AsyncIterable<UsageEvent>,
    )

    expect(events.filter((event) => event.kind === 'iteration')).toHaveLength(2)
    expect(events.filter((event) => event.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 13, output: 4 },
    ])
    expect(ex.resultArtifact()).toMatchObject({
      out: { content: 'recovered', turns: 2 },
      spent: { usdKnown: false },
    })
    await ex.teardown('brutalKill')
  })

  it('rejects a terminal Pi error instead of saving the user prompt as a result', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    const captured = await captureFailure(
      ex.execute('terminal provider error', ctx.signal) as AsyncIterable<UsageEvent>,
    )

    expect(captured.error).toBeInstanceOf(Error)
    expect(captured.error?.message).toContain('Stream ended without finish_reason')
    expect(captured.events).toContainEqual({ kind: 'cost', usd: 0, usdKnown: false })
    expect(() => ex.resultArtifact()).toThrow(/before stream drained/)
    await ex.teardown('brutalKill')
  })

  it('settles a terminal Pi error as down without checking or persisting a deliverable', async () => {
    await writeFile(commandLog, '')
    const root = 'pi-terminal-error'
    const journal = new InMemorySpawnJournal()
    await journal.beginTree(root, new Date(0).toISOString())
    const innerBlobs = new InMemoryResultBlobStore()
    let blobWrites = 0
    const blobs = {
      async put(outRef: string, artifact: unknown) {
        blobWrites += 1
        await innerBlobs.put(outRef, artifact)
      },
      get: (outRef: string) => innerBlobs.get(outRef),
    }
    let deliverableChecks = 0
    const executor = gateOnDeliverable(piExecutor(spec, piCtx()), {
      check: () => {
        deliverableChecks += 1
        return true
      },
    })
    const agentSpec: AgentSpec = { ...spec, executor }
    const agent = {
      name: 'pi-error-worker',
      act: async () => undefined,
      executorSpec: agentSpec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const scope = createScope<unknown>({
      parentId: root,
      root,
      pool: createBudgetPool({ maxIterations: 4, maxTokens: 100 }),
      journal,
      blobs,
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      now: () => 0,
    })

    const spawned = scope.spawn(agent, 'terminal provider error', {
      budget: { maxIterations: 4, maxTokens: 100 },
      label: 'provider-error',
    })
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'down',
      reason: expect.stringContaining('Stream ended without finish_reason'),
    })
    expect(deliverableChecks).toBe(0)
    expect(blobWrites).toBe(0)
    expect(scope.progress(spawned.handle.id)).toMatchObject({
      live: false,
      status: 'failed',
      turns: 1,
      usd: 0,
      usdKnown: false,
    })
    const terminal = (await journal.loadTree(root))?.find((event) => event.kind === 'settled')
    expect(terminal).toMatchObject({
      kind: 'settled',
      status: 'down',
      spent: {
        iterations: 1,
        tokens: { input: 0, output: 0 },
        usd: 0,
        usdKnown: false,
      },
    })
    expect(terminal).not.toHaveProperty('outRef')
  })

  it('uses only the terminal successful assistant turn as output, never a tool result', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    await drain(ex.execute('empty final assistant', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(ex.resultArtifact().out).toEqual({ content: '', turns: 2 })
    await ex.teardown('brutalKill')
  })

  it('refuses a pre-aborted execution before spawning Pi or sending a prompt', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    const controller = new AbortController()
    controller.abort()

    const captured = await captureFailure(
      ex.execute('must not run', controller.signal) as AsyncIterable<UsageEvent>,
    )

    expect(captured.error?.name).toBe('AbortError')
    expect(captured.events).toEqual([])
    expect(await readCommands()).toEqual([])
  })

  it('drains Pi’s delayed terminal receipt before surfacing an active abort', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    const controller = new AbortController()
    const pending = captureFailure(
      ex.execute(
        'wait for a delayed abort receipt',
        controller.signal,
      ) as AsyncIterable<UsageEvent>,
    )
    await waitForCommand(
      (command) =>
        command.type === 'prompt' && String(command.message).includes('delayed abort receipt'),
    )

    controller.abort()
    const captured = await pending

    expect(captured.error?.name).toBe('AbortError')
    expect(captured.events).toEqual([
      { kind: 'tokens', input: 105, output: 10 },
      { kind: 'cost', usd: 0, usdKnown: false },
      { kind: 'iteration' },
    ])
    expect((await readCommands()).map((command) => command.type)).toContain('abort')
    expect(() => ex.resultArtifact()).toThrow(/before stream drained/)
  })

  it('keeps an active cancellation typed as AbortError when Pi exits without a receipt', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    const controller = new AbortController()
    const pending = captureFailure(
      ex.execute('exit on abort', controller.signal) as AsyncIterable<UsageEvent>,
    )
    await waitForCommand(
      (command) => command.type === 'prompt' && String(command.message).includes('exit on abort'),
    )

    controller.abort()
    const captured = await pending

    expect(captured.error?.name).toBe('AbortError')
    expect(captured.events).toEqual([])
    expect(() => ex.resultArtifact()).toThrow(/before stream drained/)
  })

  it('fails explicitly instead of hanging when Pi rejects a prompt at preflight', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)

    const captured = await captureFailure(
      ex.execute('reject at preflight', ctx.signal) as AsyncIterable<UsageEvent>,
    )

    expect(captured.events).toEqual([])
    expect(captured.error).toMatchObject({
      name: 'ValidationError',
      message: 'piExecutor: Pi rejected prompt: No model selected',
    })
    expect(() => ex.resultArtifact()).toThrow(/before stream drained/)
  })

  it('uses pi’s state-safe prompt behavior for forceful and queued messages', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    // Deliver BEFORE draining so both messages are pending when the loop first forwards them —
    // the wrapper must not hold its own queue, it must hand them straight to pi.
    ex.deliver?.({ steer: 'switch to right.ts', interrupt: true })
    ex.deliver?.({ steer: 'and add a test', interrupt: false })

    await drain(ex.execute('make the change', ctx.signal) as AsyncIterable<UsageEvent>)
    const commands = await readCommands()

    const steer = commands.find(
      (command) => command.type === 'prompt' && command.streamingBehavior === 'steer',
    )
    const followUp = commands.find(
      (command) => command.type === 'prompt' && command.streamingBehavior === 'followUp',
    )
    expect(String(steer?.message)).toContain('switch to right.ts')
    expect(String(followUp?.message)).toContain('and add a test')
    await ex.teardown('brutalKill')
  })

  it('re-prompts pi when a steer lands while it is idle, so it cannot settle unread', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    const stream = ex.execute('make the change', ctx.signal) as AsyncIterable<UsageEvent>

    const seen: UsageEvent[] = []
    let steered = false
    for await (const e of stream) {
      seen.push(e)
      // The first completed turn is the boundary: deliver there, and pi must run again.
      if (!steered && e.kind === 'iteration') {
        steered = true
        ex.deliver?.({ steer: 'the change belongs in right.ts', interrupt: false })
        expect(ex.progress?.()?.pendingMessages).toBe(1)
      }
    }
    // Each prompt contains a tool turn and a terminal assistant turn.
    expect(seen.filter((e) => e.kind === 'iteration').length).toBe(4)
    expect(seen.filter((e) => e.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 38, output: 12 },
      { kind: 'tokens', input: 13, output: 4 },
      { kind: 'tokens', input: 38, output: 12 },
      { kind: 'tokens', input: 13, output: 4 },
    ])
    const artifact = ex.resultArtifact()
    expect(String((artifact.out as { content: string }).content)).toContain('edited right.ts')
    expect(artifact.spent.tokens).toEqual({ input: 102, output: 32 })
    expect(artifact.spent.usd).toBe(0.006)
    await ex.teardown('brutalKill')
  })

  it('teardown asks pi to `abort` before killing the process', async () => {
    await writeFile(commandLog, '')
    const ctx = piCtx()
    const ex = piExecutor(spec, ctx)
    const stream = ex.execute('make the change', ctx.signal) as AsyncIterable<UsageEvent>
    // Start the process, then tear it down mid-stream.
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    const res = await ex.teardown(500)
    expect(res.destroyed).toBe(true)
    const commands = await readCommands()
    expect(commands.map((c) => c.type)).toContain('abort')
  })

  it('accepts a seam-less context (all fields optional) without throwing at construction', () => {
    expect(() =>
      piExecutor(spec, { signal: new AbortController().signal, seams: {} }),
    ).not.toThrow()
    expect(() => piExecutor(spec, piCtx())).not.toThrow()
  })
})
