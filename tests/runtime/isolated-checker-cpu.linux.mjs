// Real delegated Linux execution; no containers, credentials or model calls.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { meanConfidenceInterval } from '@tangle-network/agent-eval'
import { isolatedCheckResultSchema } from '../../dist/index.js'
import { createIsolatedCheckCpuSession, runIsolatedCheck } from '../../dist/kernel.js'

const journal = (record) => {
  if (process.env.RUNTIME_CPU_PROOF_JOURNAL)
    appendFileSync(
      process.env.RUNTIME_CPU_PROOF_JOURNAL,
      `${JSON.stringify({ allocation: JSON.parse(process.env.BEELINK_GATE_CORES ?? 'null'), ...record })}\n`,
    )
}
if (process.argv.includes('--cpu-observer-worker')) {
  const [tree, metadata, marker] = process.argv.slice(-3)
  const opened = await createIsolatedCheckCpuSession()
  assert.equal(opened.succeeded, true, JSON.stringify(opened))
  const session = opened.value
  await writeFile(
    metadata,
    JSON.stringify({ path: session.cgroupPath, inode: (await stat(session.cgroupPath)).ino }),
  )
  await runIsolatedCheck({
    workspaceRoot: tree,
    tree,
    cpuSession: session,
    timeoutMs: 30000,
    command: [
      '/usr/bin/python3',
      '-I',
      '-c',
      `import ctypes,time; ctypes.CDLL(None).prctl(15,${JSON.stringify(marker)}.encode(),0,0,0); time.sleep(30)`,
    ],
  })
  await session.close()
  process.exit(0)
}

async function observerDeath(tree, workspace) {
  const marker = `cpu-proof-${process.pid.toString(16).slice(-5)}`
  const metadata = join(workspace, 'observer.json')
  const worker = spawn(
    process.execPath,
    [import.meta.filename, '--cpu-observer-worker', tree, metadata, marker],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const exited = once(worker, 'exit')
  let identity
  let candidate
  let outcome
  let cleanupFailure
  let stderr = ''
  worker.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const snapshot = async () => {
    if ((await stat(identity.path)).ino !== identity.inode)
      throw new Error('Observer cgroup identity changed')
    const pids = (await readFile(join(identity.path, 'cgroup.procs'), 'utf8'))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const processes = []
    for (const pid of pids) {
      try {
        const raw = await readFile(`/proc/${pid}/stat`, 'utf8')
        const end = raw.lastIndexOf(')')
        const fields = raw.slice(end + 2).split(' ')
        processes.push({
          pid: Number(pid),
          comm: raw.slice(raw.indexOf('(') + 1, end),
          parent: Number(fields[1]),
          born: fields[19],
        })
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
      }
    }
    return {
      identity,
      processes,
      events: await readFile(join(identity.path, 'cgroup.events'), 'utf8'),
    }
  }
  try {
    const readyDeadline = performance.now() + 10000
    while (performance.now() < readyDeadline && !candidate) {
      try {
        identity ??= JSON.parse(await readFile(metadata, 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      }
      if (identity) {
        assert.equal(dirname(identity.path), dirname(session.cgroupPath))
        assert.match(identity.path.split('/').at(-1), /^runtime-check-[0-9a-f-]{36}$/)
        const ready = await snapshot()
        candidate = ready.processes.find((p) => p.comm === marker)
        if (candidate)
          journal({ kind: 'cpu-observer-ready', observerPid: worker.pid, candidate, ...ready })
      }
      if (!candidate) await delay(20)
    }
    assert.ok(candidate, `CPU workload must actually execute before observer death: ${stderr}`)
    assert.notEqual(candidate.parent, worker.pid)
    worker.kill('SIGKILL')
    await exited
    const deadline = performance.now() + 5000
    let after = await snapshot()
    while (!/^populated 0$/m.test(after.events) && performance.now() < deadline) {
      await delay(20)
      after = await snapshot()
    }
    journal({ kind: 'cpu-observer-dead', observerPid: worker.pid, candidate, ...after })
    assert.match(
      after.events,
      /^populated 0$/m,
      'Actual CPU workload must stop with its Node observer',
    )
    await rmdir(identity.path)
    await assert.rejects(access(identity.path), { code: 'ENOENT' })
    outcome = {
      candidate,
      observerPid: worker.pid,
      identity,
      workloadStopped: true,
      emptyOwnedCgroupRecovered: true,
    }
  } finally {
    journal({ kind: 'cpu-observer-cleanup', identity, observerPid: worker.pid, stderr })
    worker.kill('SIGKILL')
    await exited.catch((error) => {
      cleanupFailure = error
    })
    if (identity) {
      try {
        assert.equal(
          (await stat(identity.path)).ino,
          identity.inode,
          'Recovery cgroup identity changed',
        )
        // Preserve a live-workload failure before cleaning only this exact owned test group.
        await writeFile(join(identity.path, 'cgroup.kill'), '1')
        const end = performance.now() + 5000
        while (
          !/^populated 0$/m.test(await readFile(join(identity.path, 'cgroup.events'), 'utf8')) &&
          performance.now() < end
        )
          await delay(20)
        await rmdir(identity.path)
      } catch (error) {
        if (error.code !== 'ENOENT') {
          cleanupFailure = error
          journal({ kind: 'cpu-observer-cleanup-failed', identity, diagnostic: String(error) })
        }
      }
    }
  }
  if (cleanupFailure) throw cleanupFailure
  return outcome
}

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
  journal({ kind: 'cpu-case', observation: observations.at(-1) })
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
  const observerDeathResult = await observerDeath(tree, workspace)
  assert.deepEqual(await limits(), beforeLimits)
  const arithmetic = meanConfidenceInterval([-1, 0, 1], 0.9)
  assert.equal(arithmetic.n, 3)
  assert.ok(Math.abs(arithmetic.criticalValue - 2.919985580355516) < 1e-7)
  assert.ok(Math.abs(arithmetic.low + 1.685854460848) < 1e-7)
  console.log(
    JSON.stringify({
      observations,
      observerDeath: observerDeathResult,
      arithmetic,
      unchangedParentLimits: true,
      ownedCgroupRemoved: true,
    }),
  )
} finally {
  await session.close()
  await rm(workspace, { recursive: true })
}
