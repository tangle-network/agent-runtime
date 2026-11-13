// Real delegated Linux execution; no containers, credentials or model calls.
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { meanConfidenceInterval } from '@tangle-network/agent-eval'
import { isolatedCheckResultSchema } from '../../dist/index.js'
import { createIsolatedCheckCpuSession, runIsolatedCheck } from '../../dist/kernel.js'

const workspace = await mkdtemp(join(tmpdir(), 'runtime-cpu-proof-'))
const tree = join(workspace, 'candidate')
await mkdir(tree)
await writeFile(join(workspace, 'private'), 'must remain inaccessible')
const opened = await createIsolatedCheckCpuSession()
assert.equal(opened.succeeded, true, JSON.stringify(opened))
const session = opened.value
const parent = dirname(session.cgroupPath)
const limits = async () =>
  Promise.all(
    ['cpu.max', 'memory.max', 'pids.max'].map((file) => readFile(join(parent, file), 'utf8')),
  )
const beforeLimits = await limits()
const allocation = JSON.parse(process.env.BEELINK_GATE_CORES ?? 'null')
const observations = []
const run = async (name, program, options = {}) => {
  const began = performance.now()
  const result = await runIsolatedCheck({
    workspaceRoot: workspace,
    tree,
    command: ['/usr/bin/python3', '-I', '-c', program],
    cpuSession: session,
    timeoutMs: 5000,
    ...options,
  })
  isolatedCheckResultSchema.parse(result)
  observations.push({ name, allocation, fullWallMs: performance.now() - began, result })
  return result
}
const burn =
  'import time; end=time.process_time()+0.15\nwhile time.process_time()<end: pass\nprint("ok")'
try {
  const first = await run('process-cpu', burn)
  assert.equal(first.succeeded, true, JSON.stringify(first))
  assert.equal(first.command.cpu.available, true, JSON.stringify(first))
  const cpu = first.command.cpu
  assert.equal(cpu.sessionId, session.id)
  assert.equal(cpu.cgroupPath, session.cgroupPath)
  assert.equal(cpu.inode, (await stat(session.cgroupPath)).ino)
  assert.ok(cpu.after.usageUsec - cpu.before.usageUsec >= 140000)
  const second = await run('sequential-identity', burn)
  assert.equal(second.succeeded, true, JSON.stringify(second))
  for (const key of ['usageUsec', 'userUsec', 'systemUsec'])
    assert.equal(second.command.cpu.before[key], cpu.after[key])
  assert.equal(cpu.before.resources.ancestorsComplete, true)
  assert.notEqual(cpu.before.resources.runnableWaitSomeUsec, null)
  assert.equal(cpu.before.resources.ancestors[0].cgroupPath, parent)
  assert.match(cpu.before.resources.ancestors[0].cpuMax, /^(max|[0-9]+) [0-9]+$/)
  assert.equal(second.command.inputDigest, first.command.inputDigest)
  assert.match(first.command.inputDigest, /^sha256:[a-f0-9]{64}$/)
  const descendant = await run(
    'detached-descendant-cpu',
    'import os,time\npid=os.fork()\nif pid==0:\n os.setsid()\n end=time.process_time()+0.25\n while time.process_time()<end: pass\n os._exit(0)\nos.waitpid(pid,0)\nprint("joined")',
  )
  assert.equal(descendant.succeeded, true, JSON.stringify(descendant))
  assert.ok(
    descendant.command.cpu.after.usageUsec - descendant.command.cpu.before.usageUsec >= 240000,
  )
  const custody = await run(
    'files-pids-mounts-userns',
    `import os,subprocess
assert not os.path.exists(${JSON.stringify(join(workspace, 'private'))})
assert not os.path.exists('/sys/fs/cgroup/cgroup.procs')
assert not os.path.exists('/proc/self/fd/3')
assert not os.path.exists('/proc/self/fd/4')
assert not os.path.exists('/proc/self/fd/5')
assert subprocess.run(['/usr/bin/unshare','--user','--map-root-user','true'],capture_output=True).returncode!=0
assert subprocess.run(['/bin/mount','-t','cgroup2','none','/tmp'],capture_output=True).returncode!=0
print('sealed')`,
  )
  assert.equal(custody.succeeded, true, JSON.stringify(custody))
  const active = run('busy-session', 'import time; time.sleep(0.2)')
  const competing = await run('concurrent-refused', 'raise Exception("must not start")')
  assert.equal(competing.reason, 'refused')
  await assert.rejects(session.close(), /active/)
  assert.equal((await active).succeeded, true)
  const timed = await run(
    'detached-timeout',
    'import os,time\nif os.fork()==0:\n os.setsid()\n while True: pass\ntime.sleep(30)',
    { timeoutMs: 300 },
  )
  assert.equal(timed.reason, 'timeout', JSON.stringify(timed))
  assert.match(await readFile(join(session.cgroupPath, 'cgroup.events'), 'utf8'), /^populated 0$/m)
  const controller = new AbortController()
  const cancelled = run('cancelled', 'while True: pass', { signal: controller.signal })
  setTimeout(() => controller.abort(), 100)
  assert.equal((await cancelled).reason, 'cancelled')
  const preCancelled = await run('pre-cancelled', 'raise Exception("must not start")', {
    signal: AbortSignal.abort(),
  })
  assert.equal(preCancelled.reason, 'cancelled')
  const failed = await run('exit-failure', 'import sys; print("failure"); sys.exit(7)')
  assert.equal(failed.reason, 'failed')
  assert.equal(failed.exitCode, 7)
  const output = await run('bounded-output', 'import os\nwhile True: os.write(1,b"x"*1024)', {
    maxOutputBytes: 64,
  })
  assert.equal(output.reason, 'output-limit')
  assert.equal(output.command.outputComplete, false)
  const fake = await run('forged-session-refused', burn, { cpuSession: { ...session } })
  assert.equal(fake.reason, 'refused')
  assert.deepEqual(await limits(), beforeLimits)
  assert.match(await readFile(join(session.cgroupPath, 'cgroup.events'), 'utf8'), /^populated 0$/m)
  await session.close()
  await session.close()
  await assert.rejects(access(session.cgroupPath), { code: 'ENOENT' })
  assert.equal((await run('closed-session-refused', burn)).reason, 'refused')
  const arithmetic = meanConfidenceInterval([-1, 0, 1], 0.9)
  assert.equal(arithmetic.n, 3)
  assert.ok(Math.abs(arithmetic.criticalValue - 2.919985580355516) < 1e-7)
  assert.ok(Math.abs(arithmetic.low + 1.685854460848) < 1e-7)
  console.log(
    JSON.stringify({
      observations,
      arithmetic,
      unchangedParentLimits: true,
      ownedCgroupRemoved: true,
    }),
  )
} finally {
  await session.close()
  await rm(workspace, { recursive: true })
}
