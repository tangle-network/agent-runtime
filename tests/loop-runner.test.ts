import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { coderLoopRunner, type DelegatedLoopRegistry, runDelegatedLoop } from '../src/loop-runner'
import type { CoderOutput } from '../src/profiles/coder'

const clock = () => {
  let t = 0
  return () => (t += 100)
}

describe('runDelegatedLoop — mode dispatch', () => {
  it('routes to the registered runner and returns a uniform ok result', async () => {
    const registry: DelegatedLoopRegistry = {
      research: async () => ({ grounded: 3 }),
    }
    const r = await runDelegatedLoop('research', registry, { now: clock() })
    expect(r.mode).toBe('research')
    expect(r.ok).toBe(true)
    expect(r.output).toEqual({ grounded: 3 })
    expect(r.durationMs).toBeGreaterThan(0)
  })

  it('fails loud (ConfigError) on a mode with no registered runner', async () => {
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(ConfigError)
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(
      /no runner registered for mode 'audit'/,
    )
  })

  it('captures a thrown engine as ok:false (unattended runs record, not crash)', async () => {
    const registry: DelegatedLoopRegistry = {
      'self-improve': async () => {
        throw new Error('reflection model 502')
      },
    }
    const r = await runDelegatedLoop('self-improve', registry, { now: clock() })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('reflection model 502')
    expect(r.durationMs).toBeGreaterThan(0)
  })
})

describe('coderLoopRunner — code mode over the hardened delegate', () => {
  it('runs the coder delegate and returns its winning CoderOutput', async () => {
    const out: CoderOutput = {
      branch: 'feat/fix',
      patch: 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+ok\n',
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    const sandboxClient = {
      async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { result: out } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }
    const runner = coderLoopRunner({
      sandboxClient,
      args: { goal: 'fix x', repoRoot: '/repo' },
    })
    const registry: DelegatedLoopRegistry = { code: runner }
    const r = await runDelegatedLoop<CoderOutput>('code', registry)
    expect(r.ok).toBe(true)
    expect(r.output?.branch).toBe('feat/fix')
  })
})
