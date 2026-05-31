import { describe, expect, it, vi } from 'vitest'
import type { DelegatedLoopRegistry } from '../src/loop-runner'
import { parseLoopRunnerArgv, runLoopRunnerCli } from '../src/loop-runner-bin'

describe('loop-runner-bin module-load safety', () => {
  it('does not throw at import when process.argv is undefined (Cloudflare Workers runtime)', async () => {
    // Regression: the bin's run-as-main guard read `process.argv[1]` directly.
    // When agent-runtime is bundled into a Worker (process is a shim without
    // `argv`), that threw `Cannot read properties of undefined (reading '1')`
    // at module load, crashing the Worker on startup (CF validation error
    // 10021) and breaking every consumer that imports the testable core.
    const savedArgv = process.argv
    try {
      ;(process as unknown as { argv?: string[] }).argv = undefined
      vi.resetModules()
      await expect(import('../src/loop-runner-bin')).resolves.toBeDefined()
    } finally {
      process.argv = savedArgv
      vi.resetModules()
    }
  })
})

describe('parseLoopRunnerArgv', () => {
  it('parses --mode/--config in both space and = forms', () => {
    expect(parseLoopRunnerArgv(['--mode', 'research', '--config', './c.js'])).toEqual({
      mode: 'research',
      config: './c.js',
    })
    expect(parseLoopRunnerArgv(['--mode=code', '--config=./c.js'])).toEqual({
      mode: 'code',
      config: './c.js',
    })
  })
})

describe('runLoopRunnerCli', () => {
  it('exit 0 when the selected runner succeeds', async () => {
    const registry: DelegatedLoopRegistry = { research: async () => ({ grounded: 2 }) }
    const r = await runLoopRunnerCli({ mode: 'research', loadRegistry: () => registry })
    expect(r.exitCode).toBe(0)
    expect(r.result?.ok).toBe(true)
    expect(r.result?.output).toEqual({ grounded: 2 })
  })

  it('exit 1 when the runner fails (recorded, not crashed)', async () => {
    const registry: DelegatedLoopRegistry = {
      'self-improve': async () => {
        throw new Error('router 502')
      },
    }
    const r = await runLoopRunnerCli({ mode: 'self-improve', loadRegistry: () => registry })
    expect(r.exitCode).toBe(1)
    expect(r.result?.ok).toBe(false)
    expect(r.result?.error).toBe('router 502')
  })

  it('exit 2 on an unknown mode', async () => {
    const r = await runLoopRunnerCli({ mode: 'nonsense', loadRegistry: () => ({}) })
    expect(r.exitCode).toBe(2)
    expect(r.error).toMatch(/unknown mode/)
  })

  it('exit 2 when the config registers no runner for the mode', async () => {
    const r = await runLoopRunnerCli({
      mode: 'audit',
      loadRegistry: () => ({ code: async () => 1 }),
    })
    expect(r.exitCode).toBe(2)
    expect(r.error).toMatch(/registers no runner for mode 'audit'/)
  })

  it('exit 2 when the config module fails to load', async () => {
    const r = await runLoopRunnerCli({
      mode: 'code',
      loadRegistry: () => {
        throw new Error('module not found')
      },
    })
    expect(r.exitCode).toBe(2)
    expect(r.error).toMatch(/failed to load registry/)
  })
})
