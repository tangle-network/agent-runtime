// Sealed pursuit-version results, identity checks and settled outcome evidence.

import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  SearchArtifactRef,
  SearchAttemptAccounting,
  SearchNode,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { RuntimeRunStateError, ValidationError } from '../errors'
import { isFiniteNumber } from '../finite-number'
import type { Spend, SupervisedResult } from '../runtime/supervise/types'
import { errorMessage } from '../runtime/util'
import { isNoEntError } from './jsonl-file'
import type { JudgedPursuitVersion, VersionVerdict } from './pursuit-versions'
import { parseSettleRecord, SETTLE_RECORD_FILE } from './settle-record'

/** The chain's directory beside the first version's: the ledger and its content blobs. */
export function pursuitVersionsLedgerPath(runDir: string): string {
  return resolve(`${resolve(runDir.trim())}.search`, 'ledger.jsonl')
}

/** A search node's artifact: a version's profile, or a change that did not apply. */
export interface VersionNode {
  readonly profile: AgentProfile | null
  /** The change from the parent; set on a node a proposal returned in this process. */
  readonly change?: AgentProfileDiff
  readonly parentDigest?: Sha256Digest
  readonly refusal: string | null
}

/** One node of the chain, as the ledger records it. */
export interface VersionRecord {
  readonly nodeId: string
  readonly version: number
  readonly runId: string
  readonly runDir: string
  /** Null for a change that did not apply. */
  readonly profile: AgentProfile | null
  readonly parentNodeId: string | null
  /** The change from the parent, from the node's first edge. */
  readonly change?: AgentProfileDiff
  /** The settled attempt's seal and verdict. */
  readonly seal?: SearchArtifactRef
  readonly verdict?: VersionVerdict
}

/** The bytes of a version's sealed `result.json` and the record they hold, parsed from the same
 *  bytes that are hashed. */
export async function readSealed(
  runDir: string,
  version: number,
): Promise<{ bytes: Uint8Array; result: SupervisedResult<unknown> }> {
  const path = resolve(runDir, SETTLE_RECORD_FILE)
  let bytes: Uint8Array
  try {
    bytes = await readFile(path)
  } catch (error) {
    if (!isNoEntError(error)) throw error
    throw new RuntimeRunStateError(
      `supervisePursuit versions: version ${version} has no settle record in ${runDir}`,
    )
  }
  return { bytes, result: parseSettleRecord(Buffer.from(bytes).toString('utf8'), path) }
}

/** A profile as the JSON the ledger stores: validated, with undefined entries absent. */
export function jsonProfile(profile: unknown): AgentProfile {
  canonicalAgentProfileDigest(profile as AgentProfile)
  return JSON.parse(JSON.stringify(agentProfileSchema.parse(profile))) as AgentProfile
}

export function loadNode(
  store: { readBlob(ref: SearchArtifactRef): unknown },
  node: SearchNode,
): VersionNode {
  const stored = store.readBlob(node.artifact) as {
    kind?: unknown
    profile?: unknown
    change?: AgentProfileDiff | null
    parentDigest?: Sha256Digest | null
    refusal?: string | null
  }
  if (stored.kind === 'agent-profile') {
    const parsed = agentProfileSchema.safeParse(stored.profile)
    if (!parsed.success) {
      throw new RuntimeRunStateError(`version node ${node.nodeId} holds an invalid AgentProfile`)
    }
    return { profile: parsed.data as AgentProfile, refusal: null }
  }
  if (stored.kind === 'unapplied-change') {
    return {
      profile: null,
      ...(stored.change ? { change: stored.change } : {}),
      ...(stored.parentDigest ? { parentDigest: stored.parentDigest } : {}),
      refusal: stored.refusal ?? 'the change did not apply',
    }
  }
  throw new RuntimeRunStateError(`version node ${node.nodeId} holds no version artifact`)
}

/** The `<runDir>.v<n>` directory and `<runId>.v<n>` id of version `n`, beside the first. */
export function versionRun(runDir: string, runId: string, version: number) {
  return version === 1
    ? { runDir, runId }
    : { runDir: `${runDir}.v${version}`, runId: `${runId}.v${version}` }
}

/** A version's settled spend as the ledger's accounting. Unknown dollars carry the part a
 *  provider is known to have billed as their floor. */
export function versionAccounting(spent: Spend | undefined): SearchAttemptAccounting {
  const tokensKnown =
    spent !== undefined &&
    spent.tokensKnown !== false &&
    spent.tokens?.tokensKnown !== false &&
    Number.isSafeInteger(spent.tokens?.input) &&
    Number.isSafeInteger(spent.tokens?.output) &&
    Number.isSafeInteger(spent.tokens?.cacheRead)
  const usdKnown = spent !== undefined && spent.usdKnown !== false && isFiniteNumber(spent.usd)
  return {
    tokens: tokensKnown
      ? {
          status: 'known',
          inputTokens: spent.tokens.input,
          outputTokens: spent.tokens.output,
          cachedTokens: spent.tokens.cacheRead!,
        }
      : {
          status: 'unknown',
          reason: `the version's settled spend reports no complete token count with its cache split (input ${spent?.tokens?.input ?? 'none'}, output ${spent?.tokens?.output ?? 'none'})`,
        },
    cost: usdKnown
      ? { status: 'known', usd: spent.usd, source: 'provider' }
      : {
          status: 'unknown',
          knownLowerBoundUsd: Math.max(
            0,
            isFiniteNumber(spent?.usd) ? spent.usd - (spent.usdEstimated ?? 0) : 0,
          ),
          reason: "the version's settled spend names unpriced or unreported work",
        },
  }
}

/** How long a version that settled before its chain opened ran, from its settle record. */
export function settledElapsed(settled: SupervisedResult<unknown> | undefined): number {
  const elapsed = settled?.spentTotal?.ms
  return isFiniteNumber(elapsed) ? elapsed : 0
}

export const FREE: SearchAttemptAccounting = {
  tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  cost: { status: 'known', usd: 0, source: 'free' },
}

/**
 * What a version that did no work failed with: a driver error, by its name and its message with
 * the parts that differ between runs (digits, hex runs, absolute paths) normalized, or an unscored
 * verdict. Null for a version that ran, won or not.
 */
export function versionFailure(version: JudgedPursuitVersion): string | null {
  if (version.verdict.score === null) return 'unscored by the judge'
  const { result } = version
  if (result.kind !== 'no-winner' || result.reason !== 'driver-failed') return null
  const message = result.error.message
    .replace(/(?:\/[\w.@~+-]+){2,}/gu, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/giu, '<hex>')
    .replace(/\d+/gu, '<n>')
    .slice(0, 500)
  return `driver-failed: ${result.error.name}: ${message}`
}

export function pursuitValueDigest(value: unknown, name: string): Sha256Digest {
  try {
    return canonicalCandidateDigest(value)
  } catch (error) {
    throw new ValidationError(
      `supervisePursuit versions: the ${name} must be canonical JSON to pin the chain: ${errorMessage(error)}`,
    )
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isNoEntError(error)) return false
    throw error
  }
}

export function isSha256(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}
