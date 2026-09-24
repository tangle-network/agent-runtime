/**
 * `runGraph({ runDir })` must journal durably — the file run context's stores, not a process-local
 * default. This is the regression lock for the defect the kill-and-resume conformance suite found:
 * the graph's unconditional in-memory journal/blobs defaults SHADOWED the file stores `supervise()`
 * builds for `runDir`, so a "durable" graph run wrote no spawn journal at all, `spawn-journal.jsonl`
 * never existed, and a second process silently restarted the run from scratch.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import { runGraph } from '../../src/runtime/supervise/graph'
import { conformanceGraph, RUN_ID } from '../helpers/durability/conformance-graph'
import {
  openSideEffectSite,
  SIDE_EFFECT_TOOL_NAME,
  sideEffectToolSpec,
} from '../helpers/durability/side-effect'

describe('runGraph durable run context', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'graph-rundir-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('runDir journals to the file stores supervise resumes from', async () => {
    const site = openSideEffectSite(dir)
    const res = await runGraph(conformanceGraph(), {
      runId: RUN_ID,
      runDir: dir,
      workerSlots: 3,
      maxTurns: 24,
      perWorker: { maxIterations: 60, maxTokens: 500_000 },
      brain: async () => ({ content: 'done' }),
      makeLeafAgent: () => {
        throw new Error('no workers should spawn from a done-only brain')
      },
      extraTools: [sideEffectToolSpec()],
      executeExtraTool: async (name, args) =>
        name === SIDE_EFFECT_TOOL_NAME
          ? JSON.stringify(site.commit(String(args.idempotencyKey), args.payload))
          : null,
    })
    expect(res.result.kind).toBe('no-winner')
    expect(existsSync(join(dir, 'spawn-journal.jsonl'))).toBe(true)
    // (`blobs/` is created lazily on the first settled result, so its absence here says nothing.)
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const tree = await journal.loadTree(RUN_ID)
    expect(tree).toBeDefined()
    // The resume contract's first reader sees the tree: one root spawned, a begin record before it.
    expect(tree?.filter((e) => e.kind === 'spawned' && e.parent === undefined)).toHaveLength(1)
  })

  it('a graph without runDir stays entirely in memory (no writes to disk)', async () => {
    const site = openSideEffectSite(join(dir, 'effects-only'))
    const res = await runGraph(conformanceGraph(), {
      runId: RUN_ID,
      workerSlots: 3,
      maxTurns: 24,
      brain: async () => ({ content: 'done' }),
      makeLeafAgent: () => {
        throw new Error('no workers should spawn from a done-only brain')
      },
      extraTools: [sideEffectToolSpec()],
      executeExtraTool: async (name, args) =>
        name === SIDE_EFFECT_TOOL_NAME
          ? JSON.stringify(site.commit(String(args.idempotencyKey), args.payload))
          : null,
    })
    expect(res.result.kind).toBe('no-winner')
    expect(existsSync(join(dir, 'spawn-journal.jsonl'))).toBe(false)
  })
})
