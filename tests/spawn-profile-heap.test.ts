import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

interface Receipt {
  readonly packetBytes: number
  readonly heapAtRootEntry: number
  readonly heapAfter: number
}

async function coordinator(mode: 'live' | 'replay', runDir: string, children: number) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--expose-gc',
      '--import',
      'tsx',
      'tests/fixtures/spawn-profile-heap.ts',
      mode,
      runDir,
      String(children),
    ],
    { cwd: process.cwd(), timeout: 90_000, maxBuffer: 1024 * 1024 },
  )
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Receipt
}

// Discovery's hosted coordinator died with V8 heap OOM after 37 spawns: every child profile mounted
// the same 5.6 MB file packet, and Runtime kept four copies per spawned child and five per child it
// recovered on restart. Children that share a packet now share its strings.
it('retains a shared child file packet once, live and after a restart replays the run', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'spawn-profile-heap-'))
  const children = 4
  try {
    const live = await coordinator('live', join(runDir, 'run'), children)
    const replay = await coordinator('replay', join(runDir, 'run'), children)
    const spawned = live.heapAfter - live.heapAtRootEntry
    const recovered = replay.heapAtRootEntry - live.heapAtRootEntry
    console.info('spawn profile heap receipt', {
      children,
      packetBytes: live.packetBytes,
      spawned,
      recovered,
    })
    // Before the fix: about 4 x children x packet live and 5 x children x packet on replay.
    expect(spawned).toBeLessThan(live.packetBytes)
    expect(recovered).toBeLessThan(2 * live.packetBytes)
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
}, 200_000)
