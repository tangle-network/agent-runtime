import { describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import type { Agent, Scope } from '../../src/runtime/supervise/types'

// Stands in for a rename of submit_result in src/mcp/tools/coordination.ts: the coordination tools
// are built with the deliverable, but none of them is the verb the server fences.
vi.mock('../../src/mcp/tools/coordination', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/mcp/tools/coordination')>()
  return {
    ...original,
    createCoordinationToolsForManager: (
      ...args: Parameters<typeof original.createCoordinationToolsForManager>
    ) => {
      const coord = original.createCoordinationToolsForManager(...args)
      return { ...coord, tools: coord.tools.filter((tool) => tool.name !== 'submit_result') }
    },
  }
})

describe('serveCoordinationMcp with an injected deliverable', () => {
  it('refuses to serve when the coordination verbs lack submit_result, instead of running the check unfenced', async () => {
    const serving = serveCoordinationMcp({
      scope: { signal: new AbortController().signal } as Scope<unknown>,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => ({}) as Agent<unknown, unknown>,
      perWorker: { maxIterations: 1, maxTokens: 1 },
      toolNames: ['await_event'],
      deliverable: { describe: 'a verified product packet', check: () => true },
    })
    await expect(serving).rejects.toThrow(ValidationError)
    await expect(serving).rejects.toThrow(
      'a deliverable is injected but the coordination verbs lack submit_result, so its check would run unfenced',
    )
  })
})
