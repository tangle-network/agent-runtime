import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import {
  type DriveHarness,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from '../../src/runtime'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

describe('supervisePursuit root steering', () => {
  it('consumes a public root steer written from the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pursuit-root-steer-'))
    roots.push(root)
    const runId = 'public-root-steer'
    const operationId = 'public-root-steer-1'
    const eventDir = supervisorRunDir(root, runId)
    const received: unknown[] = []
    let delivered!: () => void
    const deliveredPromise = new Promise<void>((resolve) => {
      delivered = resolve
    })

    writeWorkerSteer(root, runId, runId, {
      operationId,
      message: 'use the admitted root correction',
      interrupt: true,
    })

    const driveHarness: DriveHarness = Object.assign(
      async ({ coordinationMcpUrl }) => {
        await Promise.race([
          deliveredPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ])
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'stop',
          arguments: {},
        })
      },
      {
        deliver: (message: unknown) => {
          received.push(message)
          delivered()
          return true
        },
        deliverReady: () => true,
      },
    )

    await supervisePursuit(
      testAgentProfile('public-root-steer', {
        harness: 'codex',
        tools: runtimeToolDeclarations('stop'),
      }),
      'drive the root',
      {
        pursuitId: 'pursuit:public-root-steer',
        runId,
        runDir: root,
        budget: { maxIterations: 8, maxTokens: 10_000 },
        perWorker: { maxIterations: 1, maxTokens: 10 },
        driverRetry: { enabled: false },
        driveHarness,
        makeWorkerAgent: () => ({ name: 'unused', act: async () => undefined }),
      },
    )

    expect(received).toEqual([{ steer: 'use the admitted root correction', interrupt: true }])
    expect(readWorkerSteerAcknowledgement(root, operationId)).toBeUndefined()
    expect(readWorkerSteerAcknowledgement(eventDir, operationId)?.effect).toBe('delivered')
  })
})
