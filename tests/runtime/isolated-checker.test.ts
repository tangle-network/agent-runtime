import { describe, expect, it } from 'vitest'
import { runIsolatedCheck } from '../../src/runtime/isolated-checker'

describe('isolated checker refusal', () => {
  it('refuses unavailable hosts or invalid protected trees without running the command', async () => {
    const result = await runIsolatedCheck({
      workspaceRoot: '/runtime-checker-missing-workspace',
      tree: '/runtime-checker-missing-workspace/run',
      command: ['/bin/sh', '-c', 'echo must-not-run'],
    })
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(result.reason).toBe('refused')
  })
})
