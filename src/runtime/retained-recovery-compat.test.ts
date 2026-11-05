/**
 * Upgrade-compat regressions for the interface-5 recovery surfaces:
 *  - environment-stage recovery of a context-transfer run repeats the
 *    receipt-authorized lookup and verifies the receipt's run binding.
 */

import {
  type AgentEnvironmentProvider,
  execOnlyEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  acceptedContextTransferReceipt,
  retainedContextTransfer,
} from './retained-context-transfer-fixture'

describe('context-transfer recovery authority', () => {
  it('recovery passes the transfer request to the lookup and verifies the receipt binding', async () => {
    const request = retainedContextTransfer()
    const receipt = acceptedContextTransferReceipt(request)
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
