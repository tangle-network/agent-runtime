// Run in a disposable privileged Linux container; never mount untrusted host trees.
import assert from 'node:assert/strict'
import childProcess, { spawn } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'

if (process.argv.includes('--cleanup-failure')) {
  const original = childProcess.execFile
  childProcess.execFile = (file, args, options, callback) => {
    if (file === '/bin/rm') {
      queueMicrotask(() => callback(new Error('injected cleanup failure')))
      return
    }
    return original(file, args, options, callback)
  }
  syncBuiltinESMExports()
}
const { runIsolatedCheck } = await import('./isolated-checker.mjs')

if (process.argv.includes('--memory-exhaustion')) {
  assert.equal(
    (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim(),
    String(192 * 1024 * 1024),
  )
  assert.equal((await readFile('/sys/fs/cgroup/pids.max', 'utf8')).trim(), '64')
  assert.match((await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim(), /^\d+ \d+$/)
  const tree = await mkdtemp('/work/compressed-')
  try {
    const member = gzipSync(Buffer.alloc(1024 * 1024))
    await writeFile(`${tree}/compressed`, Buffer.concat(Array(512).fill(member)))
    const result = await runIsolatedCheck({
      workspaceRoot: tree,
      tree,
      command: [
        '/bin/sh',
        '-c',
        'python3 -c \'import gzip; gzip.open("compressed", "rb").read()\'',
      ],
      maxInputBytes: 1024 * 1024,
      timeoutMs: 15_000,
    })
    assert.equal(result.succeeded, false, JSON.stringify(result))
    assert.equal(result.reason, 'failed', JSON.stringify(result))
    console.log(
      `PASS: cgroup memory.max=201326592 pids.max=64; capped container survived compressed check exhaustion; result=${result.reason} exit=${result.exitCode}`,
    )
  } finally {
    await rm(tree, { recursive: true, force: true })
  }
  process.exit(0)
}

if (process.argv.includes('--cleanup-failure')) {
  const tree = await mkdtemp('/work/cleanup-failure-')
  const run = (script) =>
    runIsolatedCheck({ workspaceRoot: tree, tree, command: ['/bin/sh', '-c', script] })
  const primary = await run('echo primary-stdout; exit 7')
  assert.equal(primary.reason, 'failed', JSON.stringify(primary))
  assert.equal(primary.exitCode, 7)
  assert.match(primary.stdout, /primary-stdout/)
  assert.match(primary.cleanupDiagnostic, /injected cleanup failure/)
  const cleanup = await run('echo succeeded')
  assert.equal(cleanup.reason, 'cleanup-failed', JSON.stringify(cleanup))
  assert.equal(cleanup.exitCode, 0)
  assert.match(cleanup.stdout, /succeeded/)
  console.log('PASS: cleanup failure is typed and preserves primary failure and captured evidence')
  process.exit(0)
}

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
await chmod(`${workspace}/secret`, 0o400)
await symlink(`${workspace}/secret`, `${tree}/escape`)
await writeFile(`${tree}/input`, 'original')
const secretMode = (await stat(`${workspace}/secret`)).mode
const run = (script, rest = {}) =>
  runIsolatedCheck({ workspaceRoot: workspace, tree, command: ['/bin/sh', '-c', script], ...rest })
try {
  const result = await run(
    'test ! -e ../secret && test -L escape && test ! -e escape && test ! -e /work/checker-source && test -r input && echo changed > input && echo new > output && test -z "$HOST_SECRET" && test "$(ls /sys/class/net 2>/dev/null)" = "" && echo isolated',
  )
  assert.equal(result.succeeded, true, JSON.stringify(result))
  const began = performance.now()
  const raw = await run(
    "/usr/local/bin/node -e 'process.stdout.write(Buffer.from([0, 255, 123, 125]));process.stderr.write(Buffer.from([254, 10]));process.exit(7)'",
  )
  assert.equal(raw.reason, 'failed', JSON.stringify(raw))
  assert.equal(raw.exitCode, 7)
  assert.deepEqual(Buffer.from(raw.command.stdoutBase64, 'base64'), Buffer.from([0, 255, 123, 125]))
  assert.deepEqual(Buffer.from(raw.command.stderrBase64, 'base64'), Buffer.from([254, 10]))
  assert.equal(raw.command.outputComplete, true)
  assert.ok(raw.command.wallMs > 0 && raw.command.wallMs <= performance.now() - began)
  assert.ok(result.command.wallMs > 0 && result.command.outputComplete)
  assert.equal(await readFile(`${tree}/input`, 'utf8'), 'original')
  assert.equal((await stat(`${workspace}/secret`)).mode, secretMode)
  await assert.rejects(readFile(`${tree}/output`), { code: 'ENOENT' })
  assert.equal((await run('sleep 30', { timeoutMs: 100 })).reason, 'timeout')
  const overLimit = await run('yes', { maxOutputBytes: 64 })
  assert.equal(overLimit.reason, 'output-limit')
  assert.equal(overLimit.command.outputComplete, false)
  assert.equal(Buffer.from(overLimit.command.stdoutBase64, 'base64').length, 64)
  await writeFile(`${tree}/large-input`, Buffer.alloc(65 * 1024))
  const inputLimit = await run('echo should-not-run', { maxInputBytes: 64 * 1024 })
  assert.equal(inputLimit.reason, 'input-limit', JSON.stringify(inputLimit))
  assert.equal(inputLimit.stdout, undefined)
  const entryLimit = await run('echo should-not-run', { maxInputEntries: 2 })
  assert.equal(entryLimit.reason, 'input-limit', JSON.stringify(entryLimit))
  assert.equal((await run('true', { maxInputEntries: 3 })).succeeded, true)
  await rm(`${tree}/large-input`)
  // A small input can expand in the check. The Docker placement bounds this proof's resources.
  await writeFile(`${tree}/compressed`, gzipSync(Buffer.alloc(32 * 1024 * 1024)))
  const expansion = await run(
    'python3 -c \'import gzip; assert len(gzip.open("compressed", "rb").read()) == 32 * 1024 * 1024\'',
    { maxInputBytes: 64 * 1024 },
  )
  assert.equal(expansion.succeeded, true, JSON.stringify(expansion))
  await rm(`${tree}/compressed`)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 100)
  assert.equal((await run('sleep 30', { signal: controller.signal })).reason, 'cancelled')
  assert.equal((await run('mkdir locked && chmod 000 locked')).succeeded, true)
  const scratchBefore = (await readdir('/tmp'))
    .filter((name) => name.startsWith('runtime-check-'))
    .sort()
  const deep = await runIsolatedCheck({
    workspaceRoot: workspace,
    tree,
    command: [
      '/usr/local/bin/node',
      '-e',
      "const fs=require('node:fs');for(let i=0;i<80;i++){fs.mkdirSync('d'.repeat(64));process.chdir('d'.repeat(64))}",
    ],
  })
  assert.equal(deep.succeeded, true, JSON.stringify(deep))
  assert.deepEqual(
    (await readdir('/tmp')).filter((name) => name.startsWith('runtime-check-')).sort(),
    scratchBefore,
  )
  const spoofed = await run('echo bwrap:spoof >&2; exit 7')
  assert.equal(spoofed.reason, 'failed', JSON.stringify(spoofed))
  assert.equal(spoofed.exitCode, 7)
  assert.match(spoofed.stderr, /bwrap:spoof/)
  const stdoutFailure = await run('echo assertion-failed; exit 8')
  assert.equal(stdoutFailure.reason, 'failed')
  assert.equal(stdoutFailure.exitCode, 8)
  assert.match(stdoutFailure.stdout, /assertion-failed/)
  assert.equal((await run('test ! -e /proc/self/fd/3')).succeeded, true)
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
  const { createPrivateCasArtifactPort } = await import('./private-cas.mjs')
  const outputTree = `${workspace}/output-tree`
  await mkdir(outputTree)
  await writeFile(`${outputTree}/input.txt`, 'immutable fixture input')
  const artifacts = createPrivateCasArtifactPort(`${workspace}/output-cas`, 'isolated-check-proof')
  const outputOptions = {
    paths: ['report.txt'],
    maxFileBytes: 1024,
    maxTotalBytes: 1024,
    executionId: 'isolated-check-proof',
    artifacts,
  }
  const runOutput = (script, extra = {}) =>
    runIsolatedCheck({
      workspaceRoot: workspace,
      tree: outputTree,
      command: ['/bin/sh', '-c', script],
      outputs: outputOptions,
      ...extra,
    })
  const success = await runOutput('printf "native output fixture" > report.txt')
  assert.equal(success.succeeded, true, JSON.stringify(success))
  const failed = await runOutput('printf "native output fixture" > report.txt; exit 7')
  assert.equal(failed.reason, 'failed', JSON.stringify(failed))
  assert.equal(failed.exitCode, 7)
  const timedOut = await runOutput('printf "native output fixture" > report.txt; sleep 30', {
    timeoutMs: 1000,
  })
  assert.equal(timedOut.reason, 'timeout', JSON.stringify(timedOut))
  for (const result of [success, failed, timedOut]) {
    assert.equal(result.outputs.status, 'retained', JSON.stringify(result))
    assert.equal(result.outputs.inputDigest, success.outputs.inputDigest)
    assert.deepEqual(result.outputs.missing, [])
    assert.equal(result.outputs.source, undefined)
    assert.equal(
      Buffer.from(await artifacts.read(result.outputs.files[0].artifact)).toString(),
      'native output fixture',
    )
  }
  await assert.rejects(readFile(`${outputTree}/report.txt`), { code: 'ENOENT' })
  await writeFile(`${workspace}/blocked-cas`, 'not a directory')
  const held = await runOutput('printf "recoverable output fixture" > report.txt', {
    outputs: {
      ...outputOptions,
      artifacts: createPrivateCasArtifactPort(`${workspace}/blocked-cas`, 'isolated-check-proof'),
    },
  })
  assert.equal(held.succeeded, false, JSON.stringify(held))
  assert.equal(held.reason, 'failed')
  assert.equal(held.exitCode, 0)
  assert.equal(held.outputs.status, 'incomplete')
  assert.deepEqual(held.outputs.missing, [{ path: 'report.txt', reason: 'store-failed' }])
  assert.equal(held.outputs.source.kind, 'local')
  try {
    assert.equal(
      await readFile(`${held.outputs.source.path}/tree/report.txt`, 'utf8'),
      'recoverable output fixture',
    )
  } finally {
    await rm(held.outputs.source.path, { recursive: true, force: true })
  }
  assert.equal(await readFile(`${outputTree}/input.txt`, 'utf8'), 'immutable fixture input')
  console.log(
    'PASS: isolated output success/failure/timeout → verified private CAS; store failure → recoverable source; exact input binding; original input unchanged',
  )
  console.log(
    'PASS: parent absent, external symlink dangling, writes discarded, literal path, environment cleared, timeout, output limit, input limits, compressed expansion inside capped container, cancellation, ancestor bind refusal, PID/network isolation, parent-death termination, deep cleanup, symlink-safe cleanup, trusted execution classification, stdout failure evidence',
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}
