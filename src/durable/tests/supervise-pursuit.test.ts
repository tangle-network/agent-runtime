import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRuntimeSupervisorRun } from '@tangle-network/agent-eval/supervisor-run'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  canonicalCandidateJson,
} from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Budget } from '../../runtime/supervise/types'
import { FileObserverJournal } from '../observer-journal'
import { projectPursuit } from '../observer-projection'
import { SupervisePursuitError, supervisePursuit } from '../supervise-pursuit'

const pursuitId = 'pursuit:settle-record'
const budget: Budget = { maxIterations: 10, maxTokens: 10_000 }
const profile: AgentProfile = {
  name: 'settle-root',
  harness: 'opencode',
  model: { provider: 'offline', default: 'offline-test-model' },
}
const task = 'settle without delegating'
const identity = {
  pursuitId,
  profileDigest: canonicalAgentProfileDigest(agentProfileSchema.parse(profile)),
  taskDigest: canonicalCandidateDigest(task),
}

function options(runDir: string, runId: string, driveHarness = async () => {}) {
  return {
    pursuitId,
    runId,
    runDir,
    budget,
    makeWorkerAgent: () => {
      throw new Error('this run spawns no worker')
    },
    driveHarness,
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('supervisePursuit terminal record', () => {
  let runDir: string

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'supervise-pursuit-record-'))
  })

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('writes result.json beside observer.jsonl as the canonical settle record', async () => {
    const executed = await supervisePursuit(profile, task, options(runDir, 'run:1'))

    const text = await readFile(join(runDir, 'result.json'), 'utf8')
    const record = JSON.parse(text)
    expect(text).toBe(`${canonicalCandidateJson(record)}\n`)
    expect(record).toMatchObject({
      ...identity,
      kind: executed.result.kind,
      runId: 'run:1',
      spentTotal: {
        usd: executed.result.spentTotal.usd,
        tokensKnown: expect.any(Boolean),
        usdKnown: expect.any(Boolean),
      },
    })
    if (executed.result.kind === 'no-winner') expect(record.reason).toBe(executed.result.reason)
    expect(record).not.toHaveProperty('out')
    expect(await exists(join(runDir, 'failure.json'))).toBe(false)

    // The record is a projection of the run: it settles at the observer's terminal instant.
    const run = executed.pursuit.runs.find((candidate) => candidate.runId === 'run:1')
    expect(record.settledAt).toBe(run?.settledAt)

    // observer.jsonl keeps its content and replay; the record is written beside it, not into it.
    const observer = new FileObserverJournal(executed.observerPath, pursuitId)
    const records = await observer.read()
    expect(projectPursuit(records)).toEqual(executed.pursuit)
    expect(
      records
        .filter((entry) => entry.event?.target === 'agent.run')
        .map((entry) => entry.event?.phase),
    ).toEqual(['before', 'after'])
  })

  it('is the terminal record agent-eval reads as the run status, bound to the journal root', async () => {
    const executed = await supervisePursuit(profile, task, options(runDir, 'run:1'))

    const record = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8'))
    expect(record.tree).toEqual({ root: executed.result.tree.root })
    const sources = await readRuntimeSupervisorRun(runDir)
    expect(JSON.parse(sources.state ?? 'null')).toMatchObject({
      id: executed.result.tree.root,
      status: executed.result.kind,
    })
  })

  it('refuses a runDir whose record is terminal under the same runId before spending', async () => {
    await supervisePursuit(profile, task, options(runDir, 'run:1'))
    const observerBefore = await readFile(join(runDir, 'observer.jsonl'), 'utf8')
    let harnessCalls = 0

    await expect(
      supervisePursuit(
        profile,
        task,
        options(runDir, 'run:1', async () => {
          harnessCalls += 1
        }),
      ),
    ).rejects.toThrow(/result\.json already records run 'run:1'/)

    expect(harnessCalls).toBe(0)
    expect(await readFile(join(runDir, 'observer.jsonl'), 'utf8')).toBe(observerBefore)
  })

  it('a new runId retires the superseded record and settles under its own identity', async () => {
    await supervisePursuit(profile, task, options(runDir, 'run:1'))
    await supervisePursuit(profile, task, options(runDir, 'run:2'))

    const record = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8'))
    expect(record).toMatchObject({ ...identity, runId: 'run:2' })
    expect(await exists(join(runDir, 'failure.json'))).toBe(false)
  })

  it('writes failure.json with the error and the same identity when Runtime throws', async () => {
    const refused = {
      ...options(runDir, 'run:1'),
      coordination: { host: '10.0.0.7', port: 8931 },
    }
    await expect(supervisePursuit(profile, task, refused)).rejects.toBeInstanceOf(
      SupervisePursuitError,
    )

    const text = await readFile(join(runDir, 'failure.json'), 'utf8')
    const record = JSON.parse(text)
    expect(text).toBe(`${canonicalCandidateJson(record)}\n`)
    expect(record).toMatchObject({
      ...identity,
      runId: 'run:1',
      error: { name: expect.any(String), message: expect.stringMatching(/loopback/) },
    })
    expect(typeof record.settledAt).toBe('number')
    expect(await exists(join(runDir, 'result.json'))).toBe(false)

    // A failure is terminal too: the same runId is refused until the caller names a new run.
    await expect(supervisePursuit(profile, task, options(runDir, 'run:1'))).rejects.toThrow(
      /failure\.json already records run 'run:1'/,
    )
  })

  it('fails closed on a malformed terminal record instead of executing over it', async () => {
    await writeFile(join(runDir, 'result.json'), '{"kind":"winner"')
    let harnessCalls = 0

    await expect(
      supervisePursuit(
        profile,
        task,
        options(runDir, 'run:1', async () => {
          harnessCalls += 1
        }),
      ),
    ).rejects.toThrow(/result\.json/)

    expect(harnessCalls).toBe(0)
  })
})
