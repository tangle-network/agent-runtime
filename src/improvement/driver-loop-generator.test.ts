/**
 * `driverLoopGenerator` proof — the driver→worker atom over a scripted brain.
 *
 * All process seams are injected (brain, harness runner, git readers, verifier)
 * so the test proves the LOOP, deterministically and offline:
 *   1. the driver's authored instruction reaches the worker verbatim (the atom:
 *      an LLM authors the goal, not a canned template),
 *   2. verifier feedback flows back to the driver, which REFINES with a second
 *      authored session, and the candidate lands once the check passes,
 *   3. the completion oracle is code-owned: a driver that claims success over a
 *      clean tree (or a failing verifier) produces `applied:false`,
 *   4. the worker-session budget fails closed with an explanatory tool result,
 *   5. without a verifier the legacy contract holds (dirty tree = candidate).
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import type { LocalHarnessResult, RunLocalHarnessOptions } from '../mcp/local-harness'
import type { ToolLoopChat } from '../runtime/tool-loop'
import type { VerifyResult } from './agentic-generator'
import { driverLoopGenerator } from './driver-loop-generator'

const finding = (claim: string): AnalystFinding =>
  ({
    schema_version: '1.0.0',
    finding_id: `f-${claim}`,
    analyst_id: 'test-analyst',
    produced_at: new Date(0).toISOString(),
    severity: 'high',
    area: 'tool-use',
    claim,
    evidence_refs: [],
    confidence: 0.9,
  }) as unknown as AnalystFinding

/** One scripted driver turn: the tool calls the "LLM" emits (arguments as JSON strings). */
type ScriptedTurn = { calls?: Array<{ name: string; args: Record<string, unknown> }>; say?: string }

/** A `ToolLoopChat` that replays a fixed script and records every conversation it saw. */
function scriptedBrain(turns: ScriptedTurn[]) {
  const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
  let i = 0
  const chat: ToolLoopChat = async (messages) => {
    seen.push(messages.map((m) => ({ ...m })))
    const turn = turns[i] ?? {}
    i += 1
    return {
      content: turn.say ?? '',
      toolCalls: (turn.calls ?? []).map((c, j) => ({
        id: `call-${i}-${j}`,
        name: c.name,
        arguments: JSON.stringify(c.args),
      })),
    }
  }
  return { chat, seen }
}

function harnessStub(onRun?: (opts: RunLocalHarnessOptions) => void) {
  const prompts: string[] = []
  const run = async (opts: RunLocalHarnessOptions): Promise<LocalHarnessResult> => {
    prompts.push(opts.taskPrompt)
    onRun?.(opts)
    return {
      exitCode: 0,
      stdout: 'worker done',
      stderr: '',
      killedBySignal: null,
      durationMs: 10,
      timedOut: false,
    }
  }
  return { run, prompts }
}

const generateArgs = (
  findings: AnalystFinding[],
  maxShots: number,
  signal = new AbortController().signal,
) => ({
  worktreePath: '/wt/cand0',
  report: undefined,
  findings,
  maxShots,
  signal,
})

describe('driverLoopGenerator — the driver→worker build atom', () => {
  it('authors the worker instruction, refines on verifier feedback, and lands the candidate', async () => {
    const findings = [finding('the agent lacks a JSON schema validator')]
    // Worktree turns dirty after the first worker session.
    let sessions = 0
    const worker = harnessStub(() => {
      sessions += 1
    })
    // Verifier: red after session 1, green after session 2 (and for the final gate).
    const verdicts: VerifyResult[] = []
    const verify = (): VerifyResult => {
      const v: VerifyResult =
        sessions < 2
          ? { ok: false, feedback: 'tests failed: missing export validateJson' }
          : { ok: true }
      verdicts.push(v)
      return v
    }
    const { chat, seen } = scriptedBrain([
      {
        calls: [
          {
            name: 'run_worker',
            args: {
              instruction:
                'Build src/validate.ts exporting validateJson(schema, value) with tests in validate.test.ts; run pnpm test until green.',
            },
          },
        ],
      },
      { calls: [{ name: 'run_verifier', args: {} }] },
      {
        calls: [
          {
            name: 'run_worker',
            args: {
              instruction:
                'Continue from the current tree; pnpm test fails because validateJson is not exported — export it from src/validate.ts and re-run the tests.',
            },
          },
        ],
      },
      { calls: [{ name: 'run_verifier', args: {} }] },
      {
        say: 'Predicted the missing-validator gap; verifier green after one refine; next I would tighten schema errors.',
      },
    ])
    const generator = driverLoopGenerator({
      brain: chat,
      runHarness: worker.run,
      verify,
      changedPaths: () => (sessions > 0 ? ['src/validate.ts', 'src/validate.test.ts'] : []),
      readDiff: () => '+ export function validateJson()',
    })
    expect(generator.kind).toBe('driver-loop:claude')

    const result = await generator.generate(generateArgs(findings, 3))

    expect(result.applied).toBe(true)
    expect(result.summary).toContain('JSON schema validator')
    // The atom: BOTH worker goals are the driver's own authored text, refine included.
    expect(worker.prompts).toEqual([
      'Build src/validate.ts exporting validateJson(schema, value) with tests in validate.test.ts; run pnpm test until green.',
      'Continue from the current tree; pnpm test fails because validateJson is not exported — export it from src/validate.ts and re-run the tests.',
    ])
    // Verifier ran for the driver twice + once more as the code-owned final gate.
    expect(verdicts.map((v) => v.ok)).toEqual([false, true, true])
    // The red verdict's feedback reached the driver as a tool message (what it refined from).
    const flat = seen.flat()
    expect(
      flat.some(
        (m) => m.role === 'tool' && String(m.content).includes('missing export validateJson'),
      ),
    ).toBe(true)
  })

  it('fails closed: a driver claiming success over a clean tree is not a candidate', async () => {
    let verifyCalls = 0
    const { chat } = scriptedBrain([{ say: 'All done, the tool is perfect.' }])
    const generator = driverLoopGenerator({
      brain: chat,
      runHarness: harnessStub().run,
      verify: () => {
        verifyCalls += 1
        return { ok: true }
      },
      changedPaths: () => [],
      readDiff: () => '',
    })
    const result = await generator.generate(generateArgs([finding('gap')], 2))
    expect(result.applied).toBe(false)
    // Clean tree short-circuits before the verifier — the claim never even reached it.
    expect(verifyCalls).toBe(0)
  })

  it('fails closed: a dirty tree with a red verifier is discarded regardless of driver prose', async () => {
    const { chat } = scriptedBrain([
      { calls: [{ name: 'run_worker', args: { instruction: 'do the change' } }] },
      { say: 'Success! Everything works.' },
    ])
    const generator = driverLoopGenerator({
      brain: chat,
      runHarness: harnessStub().run,
      verify: () => ({ ok: false, feedback: 'boot-and-probe: initialize handshake timed out' }),
      changedPaths: () => ['server.mjs'],
      readDiff: () => '+ server',
    })
    const result = await generator.generate(generateArgs([finding('gap')], 1))
    expect(result.applied).toBe(false)
    expect(result.summary).toBe('')
  })

  it('rejects a partial edit when the caller aborts after a normal worker result', async () => {
    const controller = new AbortController()
    const { chat } = scriptedBrain([
      { calls: [{ name: 'run_worker', args: { instruction: 'make a partial edit' } }] },
      { say: 'done' },
    ])
    const generator = driverLoopGenerator({
      brain: chat,
      runHarness: harnessStub(() => {
        controller.abort(new Error('cancelled after worker settlement'))
      }).run,
      changedPaths: () => ['partial.ts'],
      readDiff: () => '+ partial',
    })

    await expect(
      generator.generate(generateArgs([finding('gap')], 1, controller.signal)),
    ).rejects.toThrow(/cancelled after worker settlement/)
  })

  it('rejects a candidate when cancellation arrives during final verification', async () => {
    const controller = new AbortController()
    const { chat } = scriptedBrain([{ say: 'the existing edit is complete' }])
    const verify = async (_path: string, signal?: AbortSignal): Promise<VerifyResult> => {
      expect(signal).toBe(controller.signal)
      controller.abort(new Error('cancelled during driver verification'))
      return { ok: true }
    }
    const generator = driverLoopGenerator({
      brain: chat,
      verify,
      changedPaths: () => ['partial.ts'],
      readDiff: () => '+ partial',
    })

    await expect(
      generator.generate(generateArgs([finding('gap')], 1, controller.signal)),
    ).rejects.toThrow(/cancelled during driver verification/)
  })

  it('offers the research tool + adopt doctrine ONLY when the seam is wired', async () => {
    // Wired: the driver researches, the stub's findings flow back as a tool
    // message, and the system prompt carries the adopt-before-build doctrine.
    const queries: string[] = []
    const research = async (query: string): Promise<string> => {
      queries.push(query)
      return 'found: mcp.exa.ai — maintained web-search MCP; needs EXA_API_KEY'
    }
    const wired = scriptedBrain([
      { calls: [{ name: 'research', args: { query: 'web search MCP server' } }] },
      { say: 'Adopt mcp.exa.ai with EXA_API_KEY; no build needed.' },
    ])
    await driverLoopGenerator({
      brain: wired.chat,
      runHarness: harnessStub().run,
      research,
      changedPaths: () => [],
      readDiff: () => '',
    }).generate(generateArgs([finding('the agent cannot search the web')], 1))
    expect(queries).toEqual(['web search MCP server'])
    const flat = wired.seen.flat()
    expect(flat.some((m) => m.role === 'tool' && String(m.content).includes('mcp.exa.ai'))).toBe(
      true,
    )
    expect(
      flat.some((m) => m.role === 'system' && String(m.content).includes('ADOPT BEFORE BUILD')),
    ).toBe(true)

    // Not wired: no research tool in the specs, no doctrine, and a stray call
    // gets the not-provisioned error (live web access is not provisioned).
    const unwired = scriptedBrain([
      { calls: [{ name: 'research', args: { query: 'anything' } }] },
      { say: 'ok' },
    ])
    await driverLoopGenerator({
      brain: unwired.chat,
      runHarness: harnessStub().run,
      changedPaths: () => [],
      readDiff: () => '',
    }).generate(generateArgs([finding('gap')], 1))
    const unwiredFlat = unwired.seen.flat()
    expect(
      unwiredFlat.some((m) => m.role === 'tool' && String(m.content).includes('not provisioned')),
    ).toBe(true)
    expect(
      unwiredFlat.some(
        (m) => m.role === 'system' && String(m.content).includes('ADOPT BEFORE BUILD'),
      ),
    ).toBe(false)
  })

  it('caps worker sessions at maxShots and tells the driver, without spawning', async () => {
    const worker = harnessStub()
    const { chat, seen } = scriptedBrain([
      { calls: [{ name: 'run_worker', args: { instruction: 'first session' } }] },
      { calls: [{ name: 'run_worker', args: { instruction: 'second session (over budget)' } }] },
      { say: 'stopping' },
    ])
    const generator = driverLoopGenerator({
      brain: chat,
      runHarness: worker.run,
      changedPaths: () => ['a.ts'],
      readDiff: () => '+a',
    })
    const result = await generator.generate(generateArgs([finding('gap')], 1))
    expect(worker.prompts).toEqual(['first session'])
    const flat = seen.flat()
    expect(
      flat.some(
        (m) => m.role === 'tool' && String(m.content).includes('worker-session budget exhausted'),
      ),
    ).toBe(true)
    // No verifier configured: dirty tree IS the candidate (legacy contract).
    expect(result.applied).toBe(true)
  })
})
