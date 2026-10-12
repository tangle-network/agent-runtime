/**
 * `profile-registry` — named AgentProfiles with run receipts: the missing
 * bottom layer of the designer's memory.
 *
 * The graph registry (#1719) answers "which GRAPH won for this task shape?"
 * but a profile is reused ACROSS graphs and across products — the same
 * summarizer, the same referee, the same driver — and "did the v2 prompt
 * actually improve?" was answerable only per-graph. This module gives named
 * profiles their own receipt loop in the exact same shape as the graph
 * registry: profiles content-addressed by the interface's canonical digest,
 * one JSONL record per run, pickBest by the same documented heuristic.
 *
 * A profile record answers the question a prompt change has to answer before
 * it deserves to exist: same name, new digest — what did each version cost,
 * and did it deliver? Versions never overwrite (immutability), so old-vs-new
 * is always a controlled diff, and a product mounting the registry can refuse
 * a profile revision with no runs behind it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'

/** One completed run of one exact profile revision, under its stable NAME. */
export interface ProfileRunRecord {
  /** The profile's stable name — the registry key (routing identity). */
  readonly name: string
  /** Canonical digest of the EXACT profile revision that ran. */
  readonly profileDigest: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly outcome:
    | { readonly kind: 'delivered'; readonly summary?: string }
    | { readonly kind: 'failed'; readonly reason?: string }
  readonly cost: {
    readonly iterations?: number
    readonly tokens?: number
    readonly usd?: number
  }
  /** Where this run came from — a graph run id, a product surface, a bench. */
  readonly origin?: string
}

export interface ProfileRegistryDir {
  readonly root: string
}

const RECORDS_FILE = 'profile-records.jsonl'
const PROFILES_DIR = 'profiles'

function assertRecord(record: ProfileRunRecord): void {
  if (typeof record.name !== 'string' || record.name.trim().length === 0)
    throw new ValidationError('profile-registry: record.name is required')
  if (typeof record.profileDigest !== 'string' || record.profileDigest.length === 0)
    throw new ValidationError('profile-registry: record.profileDigest is required')
  if (record.outcome.kind !== 'delivered' && record.outcome.kind !== 'failed')
    throw new ValidationError(
      "profile-registry: record.outcome.kind must be 'delivered' | 'failed'",
    )
}

/** Open (or lazily create) a profile registry rooted at a workspace directory. */
export function profileRegistry(root: string): ProfileRegistryDir {
  if (!root || root.trim().length === 0)
    throw new ValidationError('profileRegistry: root directory is required')
  return { root }
}

async function ensureLayout(reg: ProfileRegistryDir): Promise<void> {
  await mkdir(join(reg.root, PROFILES_DIR), { recursive: true })
}

async function readRecords(reg: ProfileRegistryDir): Promise<ProfileRunRecord[]> {
  try {
    const text = await readFile(join(reg.root, RECORDS_FILE), 'utf8')
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ProfileRunRecord)
  } catch {
    return []
  }
}

/** Record one run and persist the exact profile revision beside it. The
 *  record's digest must match the supplied profile — a record always names
 *  the revision that actually ran. The revision file is write-once: a
 *  different profile under the same digest is refused. */
export async function recordProfileRun(
  reg: ProfileRegistryDir,
  profile: AgentProfile,
  record: ProfileRunRecord,
): Promise<void> {
  assertRecord(record)
  if (typeof profile?.name !== 'string' || profile.name !== record.name) {
    throw new ValidationError(
      `profile-registry: the supplied profile's name must equal record.name ('${record.name}')`,
    )
  }
  const digest = canonicalAgentProfileDigest(profile)
  if (digest !== record.profileDigest) {
    throw new ValidationError(
      `profile-registry: record.profileDigest ${record.profileDigest.slice(0, 12)} does not match the supplied profile (${digest.slice(0, 12)}) — record the revision that actually ran`,
    )
  }
  await ensureLayout(reg)
  const file = join(reg.root, PROFILES_DIR, `${digest}.json`)
  try {
    const existing = JSON.parse(await readFile(file, 'utf8')) as AgentProfile
    if (canonicalAgentProfileDigest(existing) !== digest) {
      throw new ValidationError(
        `profile-registry: revision ${digest.slice(0, 12)} is immutable but its stored copy differs — refusing to overwrite`,
      )
    }
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      // First write of this revision.
      await writeFile(file, JSON.stringify(profile), 'utf8')
    } else {
      throw error
    }
  }
  const existing = await readRecords(reg)
  const deduped = existing.filter(
    (row) =>
      !(
        row.name === record.name &&
        row.profileDigest === record.profileDigest &&
        row.startedAt === record.startedAt
      ),
  )
  deduped.push(record)
  await writeFile(
    join(reg.root, RECORDS_FILE),
    deduped.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf8',
  )
}

/** All records for one name, newest last. */
export async function profileRunsForName(
  reg: ProfileRegistryDir,
  name: string,
): Promise<ProfileRunRecord[]> {
  return (await readRecords(reg)).filter((row) => row.name === name)
}

/** The best revision of a name by the same documented heuristic as the graph
 *  registry: delivered beats failed, then cheaper (tokens, then iterations),
 *  then most recent. This is the answer to "which prompt revision is winning?"
 *  — and every alternative is a controlled diff away (versions never overwrite). */
export function pickBestProfile(
  records: ReadonlyArray<ProfileRunRecord>,
): ProfileRunRecord | undefined {
  const delivered = records.filter((row) => row.outcome.kind === 'delivered')
  if (delivered.length === 0) return undefined
  const better = (a: ProfileRunRecord, b: ProfileRunRecord): ProfileRunRecord => {
    const aTokens = a.cost.tokens ?? Number.POSITIVE_INFINITY
    const bTokens = b.cost.tokens ?? Number.POSITIVE_INFINITY
    if (aTokens !== bTokens) return aTokens < bTokens ? a : b
    const aIter = a.cost.iterations ?? Number.POSITIVE_INFINITY
    const bIter = b.cost.iterations ?? Number.POSITIVE_INFINITY
    if (aIter !== bIter) return aIter < bIter ? a : b
    return a.finishedAt >= b.finishedAt ? a : b
  }
  return delivered.reduce((best, row) => (better(best, row) === best ? best : row))
}

/** Load a stored profile revision by digest (for replaying the winning revision). */
export async function loadProfile(
  reg: ProfileRegistryDir,
  digest: string,
): Promise<AgentProfile | undefined> {
  try {
    return JSON.parse(
      await readFile(join(reg.root, PROFILES_DIR, `${digest}.json`), 'utf8'),
    ) as AgentProfile
  } catch {
    return undefined
  }
}

/** The winning revision of a name, ready to mount. */
export async function bestProfileFor(
  reg: ProfileRegistryDir,
  name: string,
): Promise<{ profile: AgentProfile; record: ProfileRunRecord } | undefined> {
  const best = pickBestProfile(await profileRunsForName(reg, name))
  if (!best) return undefined
  const profile = await loadProfile(reg, best.profileDigest)
  return profile ? { profile, record: best } : undefined
}
