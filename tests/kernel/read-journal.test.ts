import { describe, expect, it } from 'vitest'
import {
  createCoordinationTools,
  JOURNAL_READ_BOUNDS,
  type JournalPage,
  journalEventKinds,
} from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope } from '../../src/runtime'

const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const perWorker = { maxIterations: 1, maxTokens: 10 }

/** A scope with no children: every journal row in these tests is published deliberately, so the
 *  assertions read the exact log the manager wrote and nothing the fixture added. */
function emptyScope(): Scope<unknown> {
  return {
    spawn: () => ({ ok: false as const, reason: 'budget-exhausted' as const }),
    next: async () => null,
    send: () => false,
    get view() {
      return { root: 'root', nodes: [], inFlight: 0 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  } as unknown as Scope<unknown>
}

function manager(options: Partial<Parameters<typeof createCoordinationTools>[0]> = {}) {
  return createCoordinationTools({
    scope: emptyScope(),
    blobs,
    makeWorkerAgent,
    perWorker,
    ...options,
  })
}

const journalTool = (tb: ReturnType<typeof createCoordinationTools>) => {
  const found = tb.tools.find((t) => t.name === 'read_journal')
  if (!found) throw new Error('read_journal is not mounted')
  return found
}

const read = async (
  tb: ReturnType<typeof createCoordinationTools>,
  args: Record<string, unknown> = {},
): Promise<JournalPage> => (await journalTool(tb).handler(args)) as JournalPage

/** Publish `count` findings so the journal holds a known number of rows in a known order. */
async function fill(tb: ReturnType<typeof createCoordinationTools>, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await tb.raiseFinding({ fromWorker: `w${i}`, analyst: 'lens', findings: { i } })
  }
}

describe('read_journal', () => {
  it('is mounted on every manager and returns the manager’s own rows oldest first', async () => {
    const tb = manager()
    expect(tb.tools.map((t) => t.name)).toContain('read_journal')

    await fill(tb, 3)
    const page = await read(tb)
    expect(page.entries.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(page.entries.map((e) => (e.event as { type: string }).type)).toEqual([
      'finding',
      'finding',
      'finding',
    ])
    expect(page.nextRow).toBe(3)
    expect(page.remaining).toBe(0)
    expect(page.truncated).toBe(false)
  })

  it('pages by cursor: nextRow resumes exactly where the previous page stopped', async () => {
    const tb = manager()
    await fill(tb, 5)

    const first = await read(tb, { limit: 2 })
    expect(first.entries.map((e) => e.seq)).toEqual([0, 1])
    expect(first.truncated).toBe(true)
    expect(first.remaining).toBe(3)

    const second = await read(tb, { sinceRow: first.nextRow, limit: 2 })
    expect(second.entries.map((e) => e.seq)).toEqual([2, 3])

    const third = await read(tb, { sinceRow: second.nextRow, limit: 2 })
    expect(third.entries.map((e) => e.seq)).toEqual([4])
    expect(third.truncated).toBe(false)
    expect(third.remaining).toBe(0)

    const done = await read(tb, { sinceRow: third.nextRow })
    expect(done.entries).toEqual([])
    expect(done.nextRow).toBe(third.nextRow)
  })

  it('clamps limit and maxBytes to their maxima and reports the bound it applied', async () => {
    const tb = manager()
    await fill(tb, 2)
    const page = await read(tb, { limit: 10_000, maxBytes: 10_000_000 })
    expect(page.bounds.limit).toBe(JOURNAL_READ_BOUNDS.maxLimit)
    expect(page.bounds.maxBytes).toBe(JOURNAL_READ_BOUNDS.maxMaxBytes)
    expect(page.bounds.sinceRow).toBe(0)

    const defaults = await read(tb)
    expect(defaults.bounds.limit).toBe(JOURNAL_READ_BOUNDS.defaultLimit)
    expect(defaults.bounds.maxBytes).toBe(JOURNAL_READ_BOUNDS.defaultMaxBytes)
  })

  it('holds the byte budget: a page stops at maxBytes and usedBytes never exceeds it', async () => {
    const tb = manager()
    for (let i = 0; i < 6; i++) {
      await tb.raiseFinding({
        fromWorker: `w${i}`,
        analyst: 'lens',
        findings: { pad: 'x'.repeat(200) },
      })
    }
    const page = await read(tb, { maxBytes: 600 })
    expect(page.entries.length).toBeGreaterThan(0)
    expect(page.entries.length).toBeLessThan(6)
    expect(page.bounds.usedBytes).toBeLessThanOrEqual(600)
    expect(page.truncated).toBe(true)
    expect(page.remaining).toBe(6 - page.entries.length)
  })

  it('a row larger than the whole budget returns a marker so the cursor still advances', async () => {
    const tb = manager()
    await tb.raiseFinding({
      fromWorker: 'w0',
      analyst: 'lens',
      findings: { pad: 'x'.repeat(4_000) },
    })
    await tb.raiseFinding({ fromWorker: 'w1', analyst: 'lens', findings: { small: true } })

    const page = await read(tb, { maxBytes: 64 })
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]?.oversize).toMatchObject({ type: 'finding' })
    expect(page.entries[0]?.oversize?.bytes).toBeGreaterThan(64)
    expect(page.nextRow).toBe(1)

    const next = await read(tb, { sinceRow: page.nextRow, maxBytes: 512 })
    expect(next.entries.map((e) => e.seq)).toEqual([1])
    expect(next.entries[0]?.oversize).toBeUndefined()
  })

  it('filters by kind and refuses a kind it cannot return', async () => {
    const tb = manager()
    await tb.raiseFinding({ fromWorker: 'w0', analyst: 'lens', findings: { i: 0 } })
    await tool(tb, 'ask_parent').handler({
      from: 'driver',
      level: 'driver',
      question: 'which branch?',
      reason: 'ambiguous',
      urgency: 'blocks-step',
    })

    const findings = await read(tb, { kinds: ['finding'] })
    expect(findings.entries.map((e) => (e.event as { type: string }).type)).toEqual(['finding'])

    const questions = await read(tb, { kinds: ['question'] })
    expect(questions.entries.map((e) => (e.event as { type: string }).type)).toEqual(['question'])

    await expect(journalTool(tb).handler({ kinds: ['nonsense'] })).rejects.toThrow(/kinds/)
    expect([...journalEventKinds]).toContain('settled')
  })

  it('redacts secrets out of every row before they reach the model', async () => {
    const tb = manager()
    await tb.raiseFinding({
      fromWorker: 'w0',
      analyst: 'lens',
      findings: {
        note: 'export TOKEN=sk-live-abcdefghijklmnop then retry',
        api_key: 'sk-live-zzzzzzzzzzzz',
      },
    })
    const page = await read(tb)
    const text = JSON.stringify(page.entries[0]?.event)
    expect(text).not.toContain('sk-live-abcdefghijklmnop')
    expect(text).not.toContain('sk-live-zzzzzzzzzzzz')
    expect(text).toContain('[redacted]')
  })

  it('a redactor that throws degrades one row, never leaks the raw event', async () => {
    const tb = manager({
      redactJournal: () => {
        throw new Error('redactor exploded')
      },
    })
    await tb.raiseFinding({ fromWorker: 'w0', analyst: 'lens', findings: { secretish: 'value' } })
    const page = await read(tb)
    expect(page.entries[0]?.event).toEqual({
      type: 'finding',
      redactionFailed: 'redactor exploded',
    })
    expect(JSON.stringify(page.entries[0])).not.toContain('secretish')
  })

  it.each([
    ['the default redactor', undefined],
    ['a pass-through domain redactor', ((value: unknown) => value) as (v: unknown) => unknown],
    ['redaction switched off', false as const],
  ])(
    'is read-only with %s: rows share no reference with live history',
    async (_name, redactJournal) => {
      // The detach must not depend on WHICH redactor is configured. In code mode the tool result is
      // handed to model-written JavaScript, so a live reference here is a model-reachable write into
      // the run's own audit log.
      const tb = manager(redactJournal === undefined ? {} : { redactJournal })
      await tb.raiseFinding({ fromWorker: 'w0', analyst: 'lens', findings: { keep: 'me' } })
      const page = await read(tb)
      const event = page.entries[0]?.event as { finding: { findings: { keep: string } } }
      // Deeply frozen, so the write is REJECTED rather than merely landing on a copy. Either outcome
      // must leave live history untouched, which is what the assertions below check.
      try {
        event.finding.findings.keep = 'mutated'
      } catch {
        /* frozen — the stronger of the two acceptable outcomes */
      }

      const again = await read(tb)
      const after = again.entries[0]?.event as { finding: { findings: { keep: string } } }
      expect(after.finding.findings.keep).toBe('me')
      const live = tb.history()[0]?.event as { finding: { findings: { keep: string } } }
      expect(live.finding.findings.keep).toBe('me')
    },
  )

  it('a domain redactor composes with the built-in scrub, it does not replace it', async () => {
    // The rest of the runtime resolves a custom redactor THROUGH the default (`resolveRedactor`).
    // A domain hook that only masks its own field must not silently switch credential scrubbing off.
    const tb = manager({
      redactJournal: (value: unknown) =>
        JSON.parse(JSON.stringify(value).replaceAll('customer-42', '[customer]')) as unknown,
    })
    await tb.raiseFinding({
      fromWorker: 'w0',
      analyst: 'lens',
      findings: { who: 'customer-42', note: 'use sk-live-abcdefghijklmnop' },
    })
    const text = JSON.stringify((await read(tb)).entries[0]?.event)
    expect(text).toContain('[customer]')
    expect(text).not.toContain('sk-live-abcdefghijklmnop')
    expect(text).toContain('[redacted]')
  })

  it('the byte budget bounds what the caller actually receives, stamp included', async () => {
    const tb = manager()
    for (let i = 0; i < 20; i++) {
      await tb.raiseFinding({ fromWorker: `w${i}`, analyst: 'lens', findings: { i } })
    }
    const page = await read(tb, { maxBytes: 1_000 })
    // The measured bound is the assembled rows, not the bare events: an event-only measurement
    // under-counts every row by its seq/at/priority stamp and a full page overshoots the budget.
    const actualBytes = Buffer.byteLength(JSON.stringify(page.entries), 'utf8')
    expect(page.bounds.usedBytes).toBeLessThanOrEqual(1_000)
    expect(actualBytes).toBeLessThanOrEqual(1_000)
  })

  it('reports truncated when an oversize row ends the page, not just when rows are left over', async () => {
    const tb = manager()
    await tb.raiseFinding({
      fromWorker: 'w0',
      analyst: 'lens',
      findings: { pad: 'x'.repeat(4_000) },
    })
    const page = await read(tb, { maxBytes: 64 })
    // The only row was consumed AND elided. `remaining: 0` is true; `truncated: false` would tell
    // the caller it has read everything, when 4 KB of content was dropped.
    expect(page.remaining).toBe(0)
    expect(page.entries[0]?.oversize).toBeDefined()
    expect(page.truncated).toBe(true)
  })

  it('reads across a restart: prior-process rows come first and the cursor stays stable', async () => {
    // A bus seq restarts at 0 in every process, so a seq cursor would silently re-read. Rows are
    // numbered across the whole run.
    const priorJournal = [
      {
        seq: 0,
        at: 1_000,
        priority: 0,
        event: {
          type: 'finding' as const,
          finding: { fromWorker: 'w0', analyst: 'lens', findings: { where: 'before the restart' } },
        },
      },
      {
        seq: 1,
        at: 1_001,
        priority: 0,
        event: {
          type: 'finding' as const,
          finding: { fromWorker: 'w1', analyst: 'lens', findings: { where: 'before the restart' } },
        },
      },
    ]
    const tb = manager({ priorJournal })
    await tb.raiseFinding({ fromWorker: 'w2', analyst: 'lens', findings: { where: 'after' } })

    const page = await read(tb)
    expect(page.priorRows).toBe(2)
    expect(page.entries.map((e) => e.row)).toEqual([0, 1, 2])
    expect(page.entries.map((e) => e.prior)).toEqual([true, true, undefined])
    // The live row reuses seq 0, and the cursor still separates it from the prior row that had it.
    expect(page.entries.map((e) => e.seq)).toEqual([0, 1, 0])
    expect(JSON.stringify(page.entries)).toContain('before the restart')
    expect(page.nextRow).toBe(3)

    const resumed = await read(tb, { sinceRow: 2 })
    expect(resumed.entries.map((e) => e.row)).toEqual([2])
    expect(JSON.stringify(resumed.entries)).not.toContain('before the restart')
  })

  it('cannot address another manager: the schema accepts no node, worker, run or owner name', () => {
    const schema = journalTool(manager()).inputSchema as {
      properties: Record<string, unknown>
      additionalProperties: boolean
    }
    expect(Object.keys(schema.properties).sort()).toEqual([
      'kinds',
      'limit',
      'maxBytes',
      'sinceRow',
    ])
    expect(schema.additionalProperties).toBe(false)
  })

  it('a child manager reads its own journal only — a parent’s rows are unreachable', async () => {
    // Each manager node builds its own toolbox over its own bus. This is the whole subtree fence:
    // there is no shared log to filter and no argument that names one.
    const parent = manager()
    const child = manager()
    await parent.raiseFinding({ fromWorker: 'p0', analyst: 'lens', findings: { owner: 'parent' } })
    await parent.raiseFinding({ fromWorker: 'p1', analyst: 'lens', findings: { owner: 'parent' } })
    await child.raiseFinding({ fromWorker: 'c0', analyst: 'lens', findings: { owner: 'child' } })

    const childPage = await read(child)
    expect(childPage.entries).toHaveLength(1)
    expect(JSON.stringify(childPage.entries)).toContain('"owner":"child"')
    expect(JSON.stringify(childPage.entries)).not.toContain('"owner":"parent"')

    // The child's cursor is its own: asking for the parent's seq range returns the child's row,
    // never the parent's, because the seq space belongs to the child's bus.
    const parentPage = await read(parent)
    expect(parentPage.entries).toHaveLength(2)
    expect(JSON.stringify(parentPage.entries)).not.toContain('"owner":"child"')
  })
})

const tool = (tb: ReturnType<typeof createCoordinationTools>, name: string) => {
  const t = tb.tools.find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}
