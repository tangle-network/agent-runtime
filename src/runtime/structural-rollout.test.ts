import { describe, expect, it, vi } from 'vitest'
import { type AgenticSurface, type AgenticTask, runAgentic } from './strategy'
import {
  type CheckOutcome,
  type CheckRunner,
  canDisplace,
  compareCheckOutcomes,
  defaultExtractCandidate,
  filterAuthoredAsserts,
  modelAuthoredChecks,
  officialChecksFromMeta,
  type StructuralRolloutResult,
  sandboxCheckRunner,
  selectBestIndex,
  structuralRollout,
  type VisibleCheck,
  visibleCheckScore,
} from './structural-rollout'

const outcome = (
  passedOfficial: number,
  totalOfficial: number,
  passedAuthored: number,
  totalAuthored: number,
  failureOutput = '',
  crashed?: boolean,
): CheckOutcome => ({
  passedOfficial,
  totalOfficial,
  passedAuthored,
  totalAuthored,
  failureOutput,
  ...(crashed !== undefined ? { crashed } : {}),
})

describe('selection order — official above authored, crash lowest', () => {
  it('one passing official check outranks six passing authored guesses', () => {
    const officialWins = outcome(1, 1, 0, 6)
    const authoredSweep = outcome(0, 1, 6, 6)
    expect(compareCheckOutcomes(officialWins, authoredSweep)).toBeGreaterThan(0)
    expect(selectBestIndex([authoredSweep, officialWins])).toBe(1)
  })

  it('authored guesses only break official ties', () => {
    const a = outcome(1, 2, 2, 6)
    const b = outcome(1, 2, 3, 6)
    expect(compareCheckOutcomes(b, a)).toBeGreaterThan(0)
    expect(selectBestIndex([a, b])).toBe(1)
  })

  it('a crashed candidate ranks below one that ran and failed everything', () => {
    const crashed = outcome(0, 0, 0, 0, 'SyntaxError', true)
    const ranAndFailed = outcome(0, 1, 0, 6)
    expect(compareCheckOutcomes(crashed, ranAndFailed)).toBeLessThan(0)
    expect(selectBestIndex([crashed, ranAndFailed])).toBe(1)
    expect(visibleCheckScore(crashed)).toBe(-1)
    expect(visibleCheckScore(ranAndFailed)).toBe(0)
  })

  it('argmax breaks ties by FIRST index (the blind pick under zero coverage)', () => {
    const noSignal = outcome(0, 0, 0, 0)
    expect(selectBestIndex([noSignal, noSignal, noSignal])).toBe(0)
    const tie = outcome(1, 2, 1, 2)
    expect(selectBestIndex([outcome(0, 2, 2, 2), tie, tie])).toBe(1)
  })
})

describe('repair keep-best guard', () => {
  it('never displaces with fewer official passes, even when authored/overall look better', () => {
    const incumbent = outcome(2, 3, 0, 6)
    const challenger = outcome(1, 3, 6, 6)
    expect(canDisplace(challenger, incumbent)).toBe(false)
  })

  it('a crashed challenger never displaces', () => {
    expect(canDisplace(outcome(0, 0, 0, 0, '', true), outcome(0, 3, 0, 6))).toBe(false)
  })

  it('requires a STRICT improvement in the selection order', () => {
    const tie = outcome(2, 3, 1, 6)
    expect(canDisplace(tie, tie)).toBe(false)
    expect(canDisplace(outcome(2, 3, 2, 6), tie)).toBe(true)
    expect(canDisplace(outcome(3, 3, 0, 6), tie)).toBe(true)
  })
})

describe('modelAuthoredChecks — the assert filter (visible info only, frozen per task)', () => {
  const task: AgenticTask = { id: 't', systemPrompt: 's', userPrompt: 'Write add.' }

  it('keeps only single-line paren-balanced asserts mentioning the entry symbol, capped', async () => {
    const reply = [
      'Here are the tests:',
      '```python',
      'assert add(1, 2) == 3',
      'print(add(1, 2))', // not an assert
      'assert add((1, 2) == 3', // unbalanced parens
      'assert sub(1) == 0', // wrong symbol
      'assert add(0, 0) == 0',
      'assert add(-1, 1) == 0',
      'assert add(2, 2) == 4',
      'assert add(3, 3) == 6',
      'assert add(4, 4) == 8',
      'assert add(5, 5) == 10', // over the cap of 6
      '```',
    ].join('\n')
    const consult = vi.fn(async () => reply)
    const checks = await modelAuthoredChecks().generate(task, {
      count: 6,
      entrySymbol: 'add',
      consult,
    })
    expect(consult).toHaveBeenCalledOnce()
    expect(checks.map((c) => c.code)).toEqual([
      'assert add(1, 2) == 3',
      'assert add(0, 0) == 0',
      'assert add(-1, 1) == 0',
      'assert add(2, 2) == 4',
      'assert add(3, 3) == 6',
      'assert add(4, 4) == 8',
    ])
    expect(checks.every((c) => c.kind === 'authored')).toBe(true)
  })

  it('skips authoring (no LLM call) when the budget is 0 or no entry symbol resolves', async () => {
    const consult = vi.fn(async () => 'assert add(1) == 1')
    expect(await modelAuthoredChecks().generate(task, { count: 0, entrySymbol: 'add', consult })) //
      .toEqual([])
    expect(await modelAuthoredChecks().generate(task, { count: 6, consult })).toEqual([])
    expect(consult).not.toHaveBeenCalled()
  })

  it('filterAuthoredAsserts falls back to the raw reply when there is no fence', () => {
    expect(filterAuthoredAsserts('assert add(1, 1) == 2\nnope', 'add', 6)).toEqual([
      'assert add(1, 1) == 2',
    ])
  })
})

describe('officialChecksFromMeta', () => {
  it('lifts string checks from task.meta as official; anything else means none', async () => {
    const source = officialChecksFromMeta()
    const withMeta: AgenticTask = {
      id: 't',
      systemPrompt: 's',
      userPrompt: 'u',
      meta: { visibleChecks: ['assert f() == 1', 42, '  '] },
    }
    const bare: AgenticTask = { id: 't', systemPrompt: 's', userPrompt: 'u' }
    const ctx = { count: 0, consult: async () => null }
    expect(await source.generate(withMeta, ctx)).toEqual([
      { code: 'assert f() == 1', kind: 'official' },
    ])
    expect(await source.generate(bare, ctx)).toEqual([])
  })
})

describe('sandboxCheckRunner', () => {
  const task: AgenticTask = { id: 't', systemPrompt: 's', userPrompt: 'u' }
  const checks: VisibleCheck[] = [
    { code: 'assert f() == 1', kind: 'official' },
    { code: 'assert f() != 2', kind: 'authored' },
  ]

  it('throws a clear error with no execution channel — never a silent 0', async () => {
    await expect(sandboxCheckRunner().run('def f(): return 1', checks, { task })).rejects.toThrow(
      /no execution channel/,
    )
  })

  it('short-circuits an EMPTY check set to a no-signal outcome (nothing to execute)', async () => {
    expect(await sandboxCheckRunner().run('def f(): return 1', [], { task })).toEqual({
      passedOfficial: 0,
      totalOfficial: 0,
      passedAuthored: 0,
      totalAuthored: 0,
      failureOutput: '',
    })
  })

  it('parses the nonce sentinel and strips it from the repair feedback', async () => {
    const box = {
      async exec(command: string) {
        // Decode the piped program to recover the per-call nonce, as the jail would see it.
        const b64 = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(command)?.[1] ?? ''
        const program = Buffer.from(b64, 'base64').toString('utf8')
        const nonce = /SRCK-([0-9a-f]+)/.exec(program)?.[1]
        expect(nonce).toBeTruthy()
        expect(program).toContain('def f(): return 1')
        return {
          exitCode: 1,
          stdout: `SRCK-${nonce} official=1/1 authored=0/1\nCHECK FAILED: assert f() != 2 -> AssertionError: `,
          stderr: '',
        }
      },
    }
    const result = await sandboxCheckRunner({ box }).run('def f(): return 1', checks, { task })
    expect(result).toMatchObject({
      passedOfficial: 1,
      totalOfficial: 1,
      passedAuthored: 0,
      totalAuthored: 1,
    })
    expect(result.failureOutput).toContain('CHECK FAILED: assert f() != 2')
    expect(result.failureOutput).not.toContain('SRCK-')
  })

  it('no sentinel in the output ⇒ crashed (ranks below ran-and-failed), with the crash detail', async () => {
    const box = {
      async exec() {
        return { exitCode: 1, stdout: '', stderr: 'SyntaxError: invalid syntax' }
      },
    }
    const result = await sandboxCheckRunner({ box }).run('def f(', checks, { task })
    expect(result.crashed).toBe(true)
    expect(result.failureOutput).toContain('SyntaxError')
    expect(result.totalOfficial).toBe(0)
  })
})

describe('defaultExtractCandidate', () => {
  it('prefers the LAST submit_answer tool call over fenced content', () => {
    const messages = [
      { role: 'assistant', content: '```python\ndef old(): pass\n```' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            function: { name: 'submit_answer', arguments: '{"answer":"def f(): return 1"}' },
          },
        ],
      },
      { role: 'tool', content: 'submission 1 recorded' },
    ]
    expect(defaultExtractCandidate(messages)).toBe('def f(): return 1')
  })

  it('prefers the fenced block containing a def over an echoed bare fence', () => {
    const messages = [
      {
        role: 'assistant',
        content:
          'The failure was:\n```\nCHECK FAILED: ...\n```\nFixed:\n```python\ndef f():\n    return 2\n```',
      },
    ]
    expect(defaultExtractCandidate(messages)).toBe('def f():\n    return 2')
  })
})

describe('structuralRollout — the strategy, end to end (offline transport, fake runner)', () => {
  it('validates the policy', () => {
    expect(() => structuralRollout({ policy: { k: 0 } })).toThrow(/policy\.k/)
    expect(() => structuralRollout({ policy: { repairRounds: -1 } })).toThrow(
      /policy\.repairRounds/,
    )
    expect(() => structuralRollout({ policy: { testgen: 1.5 } })).toThrow(/policy\.testgen/)
  })

  it('returns a typed null artifact when the pool cannot admit a candidate', async () => {
    const surface: AgenticSurface = {
      name: 'starved',
      async open() {
        return { id: 'unused', surface: 'starved' }
      },
      async tools() {
        return []
      },
      async call() {
        throw new Error('candidate should not run')
      },
      async score() {
        throw new Error('candidate should not run')
      },
      async close() {},
    }

    const result = await runAgentic({
      surface,
      task: { id: 'starved', systemPrompt: 'Solve it.', userPrompt: 'Solve it.' },
      routerBaseUrl: 'http://offline.test/v1',
      routerKey: 'k',
      model: 'stub-model',
      complete: async () => {
        throw new Error('candidate should not run')
      },
      strategy: structuralRollout({
        policy: { k: 1, repairRounds: 0, testgen: 0 },
        checkSource: { generate: async () => [] },
        checkRunner: {
          async run() {
            throw new Error('candidate should not run')
          },
        },
      }),
      budget: 1,
      rootBudget: { maxIterations: 1, maxTokens: 1 },
    })

    expect(result.repairStop).toBe('no-candidates')
    expect(result.artifact).toBeNull()
    expect(result.shots).toBe(0)
  })

  it('selects by frozen visible checks, repairs on failure output, and holds the official guard', async () => {
    // The domain: a verifier-environment-shaped surface (submit_answer only); each
    // shot's artifact scores 0 so nothing here can leak a hidden signal into selection —
    // only the fake CheckRunner speaks.
    let handles = 0
    const surface: AgenticSurface = {
      name: 'inert',
      async open() {
        handles += 1
        return { id: `h${handles}`, surface: 'inert' }
      },
      async tools() {
        return [
          {
            type: 'function' as const,
            function: {
              name: 'submit_answer',
              parameters: { type: 'object', properties: { answer: { type: 'string' } } },
            },
          },
        ]
      },
      async call(_handle, name) {
        return name === 'submit_answer' ? 'submission recorded' : `ERROR: unknown tool ${name}`
      },
      async score() {
        return { passes: 0, total: 1, errored: 0 }
      },
      async close() {},
    }

    // The offline model: each shot is two turns — a submit_answer tool call carrying the
    // candidate (the recorded channel; a content-only final reply never enters the shot's
    // conversation), then DONE. Samples produce A then B; repairs produce C then D.
    const letters = ['A', 'B', 'C', 'D']
    const bodies: Array<Record<string, unknown>> = []
    let workerCall = 0
    const complete = async (body: Record<string, unknown>) => {
      bodies.push(body)
      const shotIdx = Math.min(Math.floor(workerCall / 2), letters.length - 1)
      const firstTurn = workerCall % 2 === 0
      workerCall += 1
      const message = firstTurn
        ? {
            content: '',
            tool_calls: [
              {
                id: `c${workerCall}`,
                function: {
                  name: 'submit_answer',
                  arguments: JSON.stringify({
                    answer: `def f():\n    return "${letters[shotIdx]}"`,
                  }),
                },
              },
            ],
          }
        : { content: 'DONE' }
      return {
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }
    }

    const frozenChecks: VisibleCheck[] = [
      { code: 'assert f() == 1', kind: 'official' },
      { code: 'assert f() == 2', kind: 'official' },
      { code: 'assert f() == 3', kind: 'official' },
      { code: 'assert f() != 0', kind: 'authored' },
      { code: 'assert f() != 9', kind: 'authored' },
    ]
    const generate = vi.fn(async () => frozenChecks)

    // Scripted visible-check outcomes, keyed on the candidate the shot produced:
    //   A (sample) official 2/3 — the argmax pick, with a failure report;
    //   B (sample) official 1/3;
    //   C (repair) official 1/3 but authored 2/2 — MUST be held out by the guard;
    //   D (repair) official 3/3 — displaces, repair stops on full pass.
    const failureA = 'CHECK FAILED: assert f() == 3 -> AssertionError'
    const runnerCalls: Array<{ candidate: string; checks: VisibleCheck[] }> = []
    const checkRunner: CheckRunner = {
      async run(candidate, checks) {
        runnerCalls.push({ candidate, checks })
        if (candidate.includes('"A"')) return outcome(2, 3, 0, 2, failureA)
        if (candidate.includes('"B"')) return outcome(1, 3, 1, 2, 'CHECK FAILED: ...')
        if (candidate.includes('"C"')) return outcome(1, 3, 2, 2, 'CHECK FAILED: ...')
        return outcome(3, 3, 2, 2)
      },
    }

    const result = await runAgentic({
      surface,
      task: { id: 't1', systemPrompt: 'Solve it.', userPrompt: 'Write f.\n\ndef f():\n    ...' },
      routerBaseUrl: 'http://offline.test/v1',
      routerKey: 'k',
      model: 'stub-model',
      complete,
      innerTurns: 2,
      maxTokens: 64,
      strategy: structuralRollout({
        policy: { k: 2, repairRounds: 2, testgen: 0 },
        checkSource: { generate },
        checkRunner,
      }),
      budget: 6,
    })
    const rollout: StructuralRolloutResult & { mode: string } = result

    expect(rollout.mode).toBe('structuralRollout')
    expect(rollout.shots).toBe(4) // 2 samples + 2 repairs
    expect(rollout.repairStop).toBe('repaired-pass')
    expect(rollout.artifact).toBe('def f():\n    return "D"')

    // Checks were generated ONCE and the same frozen set fed every run.
    expect(generate).toHaveBeenCalledOnce()
    expect(runnerCalls).toHaveLength(4)
    for (const c of runnerCalls) expect(c.checks).toBe(frozenChecks)

    // Selection receipts: A won the sample argmax, C was guard-held, D displaced.
    expect(rollout.selection).toHaveLength(4)
    expect(rollout.selection.map((r) => r.candidateIndex)).toEqual([0, 1, 2, 3])
    expect(rollout.selection[2]?.reason).toMatch(/fewer official checks/)
    expect(rollout.selection.filter((r) => r.selected)).toHaveLength(1)
    expect(rollout.selection[3]?.selected).toBe(true)
    expect(rollout.selection.every((r) => r.selector === 'driver')).toBe(true)

    // Both repair shots were steered by the INCUMBENT's failure output (A's — C never
    // displaced), riding the winner's carried conversation: their opening turns end with
    // the steer as the last user message.
    const steerTurns = bodies.filter((body) => {
      const messages = body.messages as Array<{ role: string; content?: string }>
      const last = messages[messages.length - 1]
      return last?.role === 'user' && (last.content ?? '').includes('task-visible checks')
    })
    expect(steerTurns).toHaveLength(2)
    for (const body of steerTurns) {
      const messages = body.messages as Array<{ role: string; content?: string }>
      expect(messages[messages.length - 1]?.content).toContain(failureA)
    }
  })
})
