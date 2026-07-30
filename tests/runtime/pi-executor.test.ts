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
import { piExecutor, piSeamKey } from '../../src/runtime/supervise/pi-executor'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'

let dir: string
let fakePi: string
let commandLog: string

/**
 * A stand-in for `pi --mode rpc`: it records every command it receives, and scripts a worker that
 * edits `wrong.ts` until told otherwise, then edits `right.ts`. Emits pi's own event shapes.
 */
const FAKE_PI = `#!/usr/bin/env node
const fs = require('node:fs')
const log = process.env.PI_COMMAND_LOG
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const result = (text) => ({ content: [{ type: 'text', text }], details: {} })
let buf = ''
let turn = 0
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
    if (cmd.type === 'abort') { process.exit(0) }
    if (cmd.type !== 'prompt') continue
    const target = String(cmd.message).includes('right.ts') ? 'right.ts' : 'wrong.ts'
    const subscription = String(cmd.message).includes('subscription usage')
    const parallel = String(cmd.message).includes('parallel tools')
    const myTurn = turn++
    const assistant = {
      role: 'assistant',
      content: [{ type: 'text', text: 'edited ' + target }],
      usage: {
        input: 30,
        output: 12,
        cacheRead: 5,
        cacheWrite: 3,
        totalTokens: 50,
        cost: subscription
          ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          : { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 },
      },
    }
    emit({ type: 'agent_start' })
    emit({ type: 'turn_start' })
    emit({ type: 'message_start', message: assistant })
    emit({ type: 'message_end', message: assistant })
    if (parallel) {
      emit({ type: 'tool_execution_start', toolCallId: 'read-' + myTurn, toolName: 'read', args: { path: 'alpha.ts' } })
      emit({ type: 'tool_execution_start', toolCallId: 'bash-' + myTurn, toolName: 'bash', args: { command: 'pnpm test' } })
      emit({ type: 'tool_execution_end', toolCallId: 'bash-' + myTurn, toolName: 'bash', result: result('tests passed'), isError: false })
      emit({ type: 'tool_execution_end', toolCallId: 'read-' + myTurn, toolName: 'read', result: result('permission denied'), isError: true })
    } else {
      emit({ type: 'tool_execution_start', toolCallId: 't' + myTurn, toolName: 'edit', args: { path: target } })
      emit({ type: 'tool_execution_end', toolCallId: 't' + myTurn, toolName: 'edit', result: result('updated ' + target), isError: false })
    }
    emit({ type: 'turn_end', message: assistant, toolResults: [] })
    emit({ type: 'agent_end', messages: [] })
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

async function readCommands(): Promise<Array<Record<string, unknown>>> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(commandLog, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
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
    ])
    expect(events).toContainEqual({ kind: 'cost', usd: 0.002 })
    expect(events.filter((e) => e.kind === 'iteration')).toHaveLength(1)

    const progress = ex.progress?.()
    expect(progress?.turns).toBe(1)
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
    expect(artifact.spent.tokens).toEqual({ input: 38, output: 12 })
    expect(artifact.spent.usd).toBe(0.002)
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

    // UsageEvent cannot currently carry an unknown-dollar marker, so the stream emits no fake
    // $0 receipt and the direct terminal artifact retains the unknown state.
    expect(events.filter((event) => event.kind === 'cost')).toEqual([])
    expect(ex.resultArtifact().spent).toMatchObject({ usd: 0, usdKnown: false })
    await ex.teardown('brutalKill')
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
      }
    }
    // Two turns ran: the original and the steered one.
    expect(seen.filter((e) => e.kind === 'iteration').length).toBe(2)
    expect(seen.filter((e) => e.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 38, output: 12 },
      { kind: 'tokens', input: 38, output: 12 },
    ])
    const artifact = ex.resultArtifact()
    expect(String((artifact.out as { content: string }).content)).toContain('edited right.ts')
    expect(artifact.spent.tokens).toEqual({ input: 76, output: 24 })
    expect(artifact.spent.usd).toBe(0.004)
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
