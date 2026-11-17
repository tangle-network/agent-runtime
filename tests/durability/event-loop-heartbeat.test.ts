import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { MAX_EVENT_LOOP_GAP_MS } from '../helpers/event-loop-heartbeat'
import { runFixtureProcess } from '../helpers/fixture-process'

it.each(['busy', 'sync-wait', 'stopped'] as const)(
  'attributes an actual native %s gap against an independent sentinel',
  async (mode) => {
    const fixture = fileURLToPath(new URL('./fixtures/heartbeat-control.ts', import.meta.url))
    const child = await runFixtureProcess({
      cwd: process.cwd(),
      args: ['--import', 'tsx', fixture, mode],
    })
    expect(child.exitCode, child.stderr).toBe(0)
    const measured = JSON.parse(child.stdout) as {
      worstGapMs: number
      maxObservedGapMs: number
    }
    console.info('HEARTBEAT_CONTROL', child.stdout.trim())
    expect(measured.maxObservedGapMs).toBeGreaterThanOrEqual(150)
    const guard = () => expect(measured.worstGapMs).toBeLessThan(MAX_EVENT_LOOP_GAP_MS)
    if (mode === 'stopped') expect(guard).not.toThrow()
    else expect(guard).toThrow()
  },
)
