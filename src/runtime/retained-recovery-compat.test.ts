/**
 * Upgrade-compat regressions for the interface-5 recovery surfaces:
 *  - a v1-persisted interactive intent (pre-interface5 create projection) replays
 *    cleanly instead of being rejected by the exact-intent check;
 *  - environment-stage recovery of a context-transfer run repeats the
 *    receipt-authorized lookup and verifies the receipt's run binding.
 */

import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  type AgentEnvironmentProvider,
  execOnlyEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  retainedContextTransfer,
  retainedContextTransferReceipt,
} from './retained-context-transfer-fixture'
import { legacyRetainedCreateMaterial, retainedCreateMaterial } from './retained-run-intent'

const environment = {
  profile: { name: 'worker', harness: 'opencode' },
  idempotencyKey: 'env-idem',
  requestedId: 'requested-42',
  egress: { mode: 'default' },
  billingOwner: 'owner-a',
} as never

describe('legacy create-material projection', () => {
  it('omits exactly the interface-5 fields from the current projection', () => {
    const current = retainedCreateMaterial(environment)
    const legacy = legacyRetainedCreateMaterial(environment)
    expect(current).toMatchObject({ requestedId: 'requested-42', billingOwner: 'owner-a' })
    expect(legacy).not.toHaveProperty('requestedId')
    expect(legacy).not.toHaveProperty('egress')
    expect(legacy).not.toHaveProperty('billingOwner')
    expect(canonicalCandidateDigest(current)).not.toBe(canonicalCandidateDigest(legacy))
  })

  it('a pre-interface5 environment projects identically through both', () => {
    const pre = { profile: { name: 'worker', harness: 'opencode' }, idempotencyKey: 'env-idem' }
    expect(legacyRetainedCreateMaterial(pre as never)).toEqual(retainedCreateMaterial(pre as never))
  })
})

describe('context-transfer recovery authority', () => {
  it('recovery passes the transfer request to the lookup and verifies the receipt binding', async () => {
    const request = retainedContextTransfer()
    const receipt = retainedContextTransferReceipt(request)
    const seen: Array<Record<string, unknown> | undefined> = []
    const wrongRun = { ...receipt, runId: `sha256:${'b'.repeat(64)}` }

    const makeProvider = (receiptToVerify: typeof receipt): AgentEnvironmentProvider =>
      ({
        name: receipt.provider,
        capabilities: () => ({
          ...execOnlyEnvironmentCapabilities({
            read: true,
            write: true,
            exec: true,
            git: true,
            upload: false,
            download: false,
          }),
          streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
          sessions: { continue: true, list: false, messages: false },
          retainedControl: {
            exactRunIdentity: true,
            resultIdentity: true,
            eventIdentity: true,
            cancellationIdempotency: true,
          },
        }),
        create: async () => {
          throw new Error('recovery must not create')
        },
        get: async (id: string, options?: Record<string, unknown>) => {
          seen.push(options)
          if (id !== receipt.environmentId) return null
          return {
            id,
            provider: receipt.provider,
            capabilities: {
              ...execOnlyEnvironmentCapabilities({
                read: true,
                write: true,
                exec: true,
                git: true,
                upload: false,
                download: false,
              }),
              streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
              sessions: { continue: true, list: false, messages: false },
              retainedControl: {
                exactRunIdentity: true,
                resultIdentity: true,
                eventIdentity: true,
                cancellationIdempotency: true,
              },
            },
            contextTransferReceipt: receiptToVerify,
            status: async () => 'running' as const,
            async *stream() {},
            async dispatch() {
              throw new Error('recovery does not dispatch')
            },
            session: () => ({
              id: receipt.sessionId,
              controlRef: {
                provider: receipt.provider,
                environmentId: receipt.environmentId,
                sessionId: receipt.sessionId,
                executionId: receipt.executionId,
                runId: receipt.runId,
                requestDigest: 'sha256:' + 'a'.repeat(64),
              },
              status: async () => 'running' as const,
              async *events() {},
              result: async () => ({ text: 'done', success: true }),
              prompt: async () => ({ text: 'continued', success: true }),
              cancel: async () => {},
            }),
          } as never
        },
      }) as never

    const { recoverRetainedRun } = await import('./retained-run-start')
    // Authorized lookup + a matching receipt recovers.
    const ok = await recoverRetainedRun({
      provider: makeProvider(receipt),
      environmentId: receipt.environmentId,
      sessionId: receipt.sessionId,
      executionId: receipt.executionId,
      contextTransfer: request,
      transferReceipt: receipt,
    })
    expect(ok.outcome).toBe('recovered')
    expect(seen[0]).toMatchObject({ contextTransfer: request })

    // A receipt whose runId the transfer never bound is refused loudly.
    seen.length = 0
    const hijacked = await recoverRetainedRun({
      provider: makeProvider(wrongRun),
      environmentId: receipt.environmentId,
      sessionId: receipt.sessionId,
      executionId: receipt.executionId,
      contextTransfer: request,
      transferReceipt: receipt,
    }).catch((error: Error) => error)
    expect(hijacked).toBeInstanceOf(Error)
    expect((hijacked as Error).message).toMatch(/context transfer|receipt/i)
  })
})
