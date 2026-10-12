/**
 * The profile receipt loop: named profiles, immutable revisions, and the
 * answer to "did the v2 prompt actually improve?" — same shape as the graph
 * registry's tests, real files, no graph machinery needed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bestProfileFor,
  loadProfile,
  pickBestProfile,
  profileRegistry,
  profileRunsForName,
  recordProfileRun,
} from '../../src/runtime/supervise/profile-registry'
import { testAgentProfile } from './test-agent-profile'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'profile-registry-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

const v1 = testAgentProfile('summarizer', { prompt: { systemPrompt: 'Summarize tersely.' } })
const v2 = testAgentProfile('summarizer', { prompt: { systemPrompt: 'Summarize with citations.' } })

function digestOf(profile: AgentProfile): string {
  return canonicalAgentProfileDigest(profile)
}

async function record(
  profile: AgentProfile,
  outcome: ProfileRunRecordOutcome,
  cost: { tokens?: number; iterations?: number },
  startedAt: string,
): Promise<void> {
  await recordProfileRun(profileRegistry(workspace), profile, {
    name: profile.name ?? 'summarizer',
    profileDigest: digestOf(profile),
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    outcome,
    cost,
    origin: 'test',
  })
}

type ProfileRunRecordOutcome =
  | { kind: 'delivered'; summary?: string }
  | { kind: 'failed'; reason?: string }

describe('profile registry — named profiles with receipts', () => {
  it('records a run and persists the exact revision; the record must match it', async () => {
    await record(v1, { kind: 'delivered' }, { tokens: 100 }, '2026-10-12T00:00:00Z')
    const rows = await profileRunsForName(profileRegistry(workspace), 'summarizer')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'summarizer', profileDigest: digestOf(v1) })
    expect(await loadProfile(profileRegistry(workspace), digestOf(v1))).toMatchObject({
      name: 'summarizer',
      prompt: { systemPrompt: 'Summarize tersely.' },
    })
    await expect(
      recordProfileRun(profileRegistry(workspace), v1, {
        name: 'summarizer',
        profileDigest: digestOf(v2),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: { kind: 'delivered' },
        cost: {},
      }),
    ).rejects.toThrow(/does not match the supplied profile/)
  })

  it('two revisions of one name: both recorded, neither overwritten — and the cheaper delivered one wins', async () => {
    await record(v1, { kind: 'delivered' }, { tokens: 500, iterations: 6 }, '2026-10-12T00:00:00Z')
    await record(v2, { kind: 'delivered' }, { tokens: 120, iterations: 3 }, '2026-10-12T01:00:00Z')
    const rows = await profileRunsForName(profileRegistry(workspace), 'summarizer')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.profileDigest))).toEqual(new Set([digestOf(v1), digestOf(v2)]))

    const best = await bestProfileFor(profileRegistry(workspace), 'summarizer')
    expect(best?.record.profileDigest).toBe(digestOf(v2))
    expect(best?.profile.prompt?.systemPrompt).toBe('Summarize with citations.')
  })

  it('a failing revision never wins the slot, even when cheaper', async () => {
    await record(v1, { kind: 'delivered' }, { tokens: 900 }, '2026-10-12T00:00:00Z')
    await record(
      v2,
      { kind: 'failed', reason: 'budget-exhausted' },
      { tokens: 10 },
      '2026-10-12T01:00:00Z',
    )
    const best = await bestProfileFor(profileRegistry(workspace), 'summarizer')
    expect(best?.record.profileDigest).toBe(digestOf(v1))
  })

  it('a revision file is write-once: a different profile under the same digest is refused', async () => {
    await record(v1, { kind: 'delivered' }, {}, '2026-10-12T00:00:00Z')
    const file = join(workspace, 'profiles', `${digestOf(v1)}.json`)
    await writeFile(file, JSON.stringify({ ...v1, prompt: { systemPrompt: 'tampered' } }), 'utf8')
    await expect(
      recordProfileRun(profileRegistry(workspace), v1, {
        name: 'summarizer',
        profileDigest: digestOf(v1),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: { kind: 'delivered' },
        cost: {},
      }),
    ).rejects.toThrow(/immutable/)
  })

  it('pickBestProfile on an all-failed lineage returns undefined (author territory)', async () => {
    await record(v1, { kind: 'failed' }, {}, '2026-10-12T00:00:00Z')
    expect(
      pickBestProfile(await profileRunsForName(profileRegistry(workspace), 'summarizer')),
    ).toBeUndefined()
  })
})
