// Run in a disposable privileged Linux container; never mount untrusted host trees.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { runIsolatedCheck } from '../../src/runtime/isolated-checker.ts'

if (process.argv.includes('--parent-death-worker')) {
  const [tree, marker] = process.argv.slice(-2)
  await runIsolatedCheck({
    workspaceRoot: tree,
    tree,
    command: [
      '/usr/local/bin/node',
      '-e',
      `process.title=${JSON.stringify(marker)};process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`,
    ],
  })
  process.exit(0)
}

async function findLiveMarker(marker) {
  for (const pid of (await readdir('/proc')).filter((value) => /^[0-9]+$/.test(value))) {
    try {
      const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8')
      if (cmdline.split('\0')[0] === marker) return pid
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
    }
  }
}

if (process.argv.includes('--refusal')) {
  await mkdir('/work/refusal/run', { recursive: true })
  const result = await runIsolatedCheck({
    workspaceRoot: '/work/refusal',
    tree: '/work/refusal/run',
    command: ['/bin/sh', '-c', 'echo escaped > /work/refusal/escaped'],
  })
  assert.equal(result.succeeded, false)
  assert.equal(result.reason, 'refused', JSON.stringify(result))
  await assert.rejects(readFile('/work/refusal/escaped'), { code: 'ENOENT' })
  console.log('PASS: namespace creation denied; check refused without host fallback')
  process.exit(0)
}
const workspace = await mkdtemp('/work/check-')
const tree = `${workspace}/run $(touch escaped)`
await mkdir(tree)
await writeFile(`${workspace}/secret`, 'secret')
await symlink(`${workspace}/secret`, `${tree}/escape`)
await writeFile(`${tree}/input`, 'original')
const run = (script, rest = {}) =>
  runIsolatedCheck({ workspaceRoot: workspace, tree, command: ['/bin/sh', '-c', script], ...rest })
try {
  const result = await run(
    'test ! -e ../secret && test -L escape && test ! -e escape && test ! -e /work/checker-source && test -r input && echo changed > input && echo new > output && test -z "$HOST_SECRET" && test "$(ls /sys/class/net 2>/dev/null)" = "" && echo isolated',
  )
  assert.equal(result.succeeded, true, JSON.stringify(result))
  assert.equal(await readFile(`${tree}/input`, 'utf8'), 'original')
  await assert.rejects(readFile(`${tree}/output`), { code: 'ENOENT' })
  assert.equal((await run('sleep 30', { timeoutMs: 100 })).reason, 'timeout')
  assert.equal((await run('yes', { maxOutputBytes: 64 })).reason, 'output-limit')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 100)
  assert.equal((await run('sleep 30', { signal: controller.signal })).reason, 'cancelled')
  assert.equal((await run('mkdir locked && chmod 000 locked')).succeeded, true)
  const network = await runIsolatedCheck({
    workspaceRoot: workspace,
    tree,
    command: [
      '/usr/local/bin/node',
      '-e',
      "const os=require('node:os');if(Object.keys(os.networkInterfaces()).some(k=>k!=='lo'))process.exit(1);const fs=require('node:fs');if(fs.readdirSync('/proc').filter(k=>/^[0-9]+$/.test(k)).length>4)process.exit(2)",
    ],
  })
  assert.equal(network.succeeded, true, JSON.stringify(network))
  const marker = `jail-descendant-${process.pid}`
  const worker = spawn(
    process.execPath,
    [import.meta.filename, '--parent-death-worker', tree, marker],
    { stdio: 'inherit' },
  )
  try {
    const deadline = Date.now() + 10_000
    while (!(await findLiveMarker(marker)) && Date.now() < deadline) await delay(20)
    assert.ok(
      await findLiveMarker(marker),
      'isolated child must actually start before killing its host parent',
    )
    worker.kill('SIGKILL')
    const stopped = Date.now() + 5_000
    while ((await findLiveMarker(marker)) && Date.now() < stopped) await delay(20)
    assert.equal(
      await findLiveMarker(marker),
      undefined,
      'namespace child must die with its host parent',
    )
  } finally {
    worker.kill('SIGKILL')
  }
  assert.equal((await run('exit 7')).reason, 'failed')
  assert.equal((await run('true', { timeoutMs: 0 })).reason, 'refused')
  assert.equal((await run('true', { maxOutputBytes: 0 })).reason, 'refused')
  assert.equal((await run('true', { signal: AbortSignal.abort() })).reason, 'cancelled')
  const overlap = await runIsolatedCheck({
    workspaceRoot: '/usr',
    tree: '/usr/share',
    command: ['/bin/true'],
  })
  assert.equal(overlap.reason, 'refused')
  console.log(
    'PASS: parent absent, external symlink dangling, writes discarded, literal path, environment cleared, timeout, output limit, cancellation, ancestor bind refusal, PID/network isolation, parent-death termination',
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}
