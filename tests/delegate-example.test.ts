/**
 * Regression proof for the delegate example: a router-brained supervisor AUTHORS + spawns a worker
 * (no baked-in coder profile), the worker does real on-disk filesystem work via a granted `write_file`
 * tool, and the deliverable settles ONLY when the file actually exists with the right content.
 * `result.spentTotal` carries the real conserved cost on both paths.
 *
 * The full e2e needs a real router (TANGLE_API_KEY) + a worker that tool-calls, so it is env-gated:
 * it runs as a paid proof when TANGLE_API_KEY is set and SKIPS at $0 otherwise, keeping `pnpm test`
 * green offline. The offline assertion (delegate fails loud without a brain/router) always runs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileDeliverable, makeWriteFileBackend, scratchTarget } from '../examples/delegate/shared'
import { delegate } from '../src/runtime/index'

const routerKey = process.env.TANGLE_API_KEY
const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
const brainModel = process.env.MODEL ?? process.env.BRAIN_MODEL ?? model

describe('delegate example', () => {
  it('fails loud without a supervisor brain or router (offline)', async () => {
    await expect(delegate('do something', {})).rejects.toThrow(/router|brain/)
  })

  it.skipIf(!routerKey)(
    'authors a worker that delivers the file on disk; cost rides through (live)',
    async () => {
      const { workDir, target, targetAbs } = scratchTarget()
      const backend = makeWriteFileBackend({ workDir, routerBaseUrl, routerKey: routerKey!, model })

      const result = await delegate(
        `Create a file named ${target} containing exactly the word hello (lowercase, no quotes). ` +
          `Call the write_file tool exactly once with path="${target}" and content="hello", then ` +
          `reply with the single word DONE and STOP — do not call any more tools after the file is written.`,
        {
          backend,
          router: { routerBaseUrl, routerKey: routerKey!, model: brainModel },
          model: brainModel,
          deliverable: fileDeliverable(targetAbs, target),
          budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
        },
      )

      const fileContent = existsSync(targetAbs) ? readFileSync(targetAbs, 'utf8').trim() : ''
      // The worker met the deliverable (file on disk), and real cost rode through.
      expect(result.kind, `delegate did not return a winner: ${JSON.stringify(result)}`).toBe(
        'winner',
      )
      expect(fileContent).toBe('hello')
      const tokensReal = result.spentTotal.tokens.input + result.spentTotal.tokens.output > 0
      expect(result.spentTotal.usd > 0 || tokensReal).toBe(true)
    },
    180_000,
  )
})
