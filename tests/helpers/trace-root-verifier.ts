import {
  canonicalString,
  jsonDocument,
  type LedgerHash,
  merkleInclusionProof,
  merkleLeafHash,
  merkleRoot,
  verifyMerkleInclusion,
} from '@tangle-network/agent-eval/ledger-core'
import {
  TRACE_ROOT_SCHEMA,
  TRACE_SUMMARY_SCHEMA,
  type TraceRootArtifact,
  type TraceRootReceipt,
} from '@tangle-network/agent-runtime/kernel'
import { expect } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import type { ProviderLeafOut } from '../../src/runtime/environment-provider/provider-executor-admission'
import type { ResultBlobStore } from '../../src/runtime/supervise/types'

export interface Verified {
  readonly artifact: TraceRootArtifact
  readonly events: readonly unknown[]
}

/** Recompute every leaf and the root from the stored output and artifact, as a reader would. */
export async function verifyStoredTrace(
  blobs: ResultBlobStore,
  record: { outRef?: string; traceRoot?: TraceRootReceipt },
): Promise<Verified> {
  const receipt = record.traceRoot
  if (receipt === undefined || record.outRef === undefined) throw new Error('no trace root')
  const artifact = (await blobs.get(receipt.ref)) as TraceRootArtifact
  const out = (await blobs.get(record.outRef)) as ProviderLeafOut
  expect(contentAddress(artifact)).toBe(receipt.ref)
  const n = out.events.length
  expect(artifact).toMatchObject({
    schema: TRACE_ROOT_SCHEMA,
    outRef: record.outRef,
    root: receipt.root,
    leafCount: n + 1,
  })
  expect(receipt.leafCount).toBe(n + 1)
  expect(artifact.salts).toHaveLength(n + 1)
  expect(artifact.leaves).toHaveLength(n + 1)
  out.events.forEach((event, index) => {
    expect(merkleLeafHash(canonicalString(jsonDocument(event)), artifact.salts[index])).toBe(
      artifact.leaves[index],
    )
  })
  expect(artifact.summary).toMatchObject({ schema: TRACE_SUMMARY_SCHEMA, events: n })
  expect(
    merkleLeafHash(
      canonicalString({
        schema: artifact.summary.schema,
        events: artifact.summary.events,
        toolCalls: artifact.summary.toolCalls,
      }),
      artifact.salts[n],
    ),
  ).toBe(artifact.leaves[n])
  expect(merkleRoot(artifact.leaves as LedgerHash[])).toBe(receipt.root)
  return { artifact, events: out.events }
}

/** A citation `{eventIndex, quote}` checked the way the contract states: leaf, inclusion, quote. */
export function verifyCitation(
  verified: Verified,
  root: string,
  eventText: string,
  eventIndex: number,
  quote: string,
): boolean {
  let event: unknown
  try {
    event = JSON.parse(eventText)
  } catch {
    return false
  }
  let canonical: string
  try {
    canonical = canonicalString(jsonDocument(event))
  } catch {
    return false
  }
  const salt = verified.artifact.salts[eventIndex]
  if (salt === undefined) return false
  const leaf = merkleLeafHash(canonical, salt)
  if (leaf !== verified.artifact.leaves[eventIndex]) return false
  const proof = merkleInclusionProof(verified.artifact.leaves as LedgerHash[], eventIndex)
  return (
    verifyMerkleInclusion(leaf, proof, root as LedgerHash).verified && canonical.includes(quote)
  )
}
