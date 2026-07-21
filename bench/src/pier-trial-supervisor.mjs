import { execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

const identityFile = 'identity.json'
const terminalFile = 'terminal.json'
const stopFile = 'stop-requested'

function fail(message) {
  throw new Error(message)
}

function readJson(path, label) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function syncDirectory(directory) {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeJsonAtomic(directory, name, value) {
  const target = join(directory, name)
  const temporary = join(directory, `.${name}.${process.pid}.tmp`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, target)
  syncDirectory(directory)
}

async function readControlInput() {
  const chunks = []
  for await (const chunk of createReadStream('', { fd: 3 })) {
    chunks.push(Buffer.from(chunk))
  }
  const bytes = Buffer.concat(chunks)
  if (bytes.byteLength === 0) fail('Pier supervisor received no launch request')
  return JSON.parse(bytes.toString('utf8'))
}

function processIdentity(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const closing = text.lastIndexOf(')')
  if (closing < 0) fail(`cannot parse process identity for ${pid}`)
  const fields = text.slice(closing + 2).trim().split(/\s+/)
  const processGroupId = Number(fields[2])
  const sessionId = Number(fields[3])
  const startTicks = fields[19]
  if (
    !Number.isSafeInteger(processGroupId) ||
    !Number.isSafeInteger(sessionId) ||
    !/^\d+$/.test(startTicks ?? '')
  ) {
    fail(`cannot parse process identity for ${pid}`)
  }
  return { pid, processGroupId, sessionId, startTicks }
}

function processMatches(identity) {
  try {
    const current = processIdentity(identity.pid)
    return (
      current.startTicks === identity.startTicks &&
      current.processGroupId === identity.processGroupId &&
      current.sessionId === identity.sessionId
    )
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return false
    throw error
  }
}

function sessionMembers(sessionId) {
  const members = []
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const identity = processIdentity(Number(entry.name))
      if (identity.sessionId === sessionId) members.push(identity)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return members
}

async function signalSessionUntilEmpty(identity, signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const members = sessionMembers(identity.sessionId)
    if (members.length === 0) return true
    for (const member of members) {
      try {
        process.kill(member.pid, signal)
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
}

function sanitizeProject(value) {
  let project = value.toLowerCase()
  if (!/^[a-z0-9]/.test(project)) project = `0${project}`
  return project.replace(/[^a-z0-9_-]/g, '-')
}

function trialProjects(jobsDirectory, jobName) {
  const jobRoot = join(jobsDirectory, jobName)
  if (!existsSync(jobRoot)) return []
  return readdirSync(jobRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => sanitizeProject(entry.name))
}

function matchingContainers(dockerCommand, projects) {
  if (projects.length === 0) return []
  const output = execFileSync(
    dockerCommand,
    ['ps', '-a', '--format', '{{.ID}}\t{{.Label "com.docker.compose.project"}}'],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  )
  const matches = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 1) continue
    const id = line.slice(0, tab)
    const project = line.slice(tab + 1)
    if (
      projects.some(
        (expected) =>
          project === expected || project.startsWith(`${expected}__verifier__`),
      )
    ) {
      matches.push(id)
    }
  }
  return matches
}

function removeTrialContainers(config) {
  const projects = trialProjects(config.jobsDirectory, config.jobName)
  const containers = matchingContainers(config.dockerCommand, projects)
  if (containers.length > 0) {
    try {
      execFileSync(config.dockerCommand, ['rm', '-f', ...containers], {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      if (matchingContainers(config.dockerCommand, projects).length > 0) throw error
    }
  }
  const remaining = matchingContainers(config.dockerCommand, projects)
  if (remaining.length > 0) {
    fail(`Pier task containers survived removal: ${remaining.join(', ')}`)
  }
  return containers.length
}

async function waitForExit(exited, timeoutMs) {
  return await Promise.race([
    exited.then(() => true),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), timeoutMs)),
  ])
}

const directory = resolve(process.argv[2] ?? '')
if (!isAbsolute(directory) || basename(directory) === '') {
  fail('Pier supervisor control directory must be absolute')
}

let config
let child
let childIdentity
let stopRequested = existsSync(join(directory, stopFile))
let stopping

async function stopChild() {
  if (!child) return
  if (!childIdentity) {
    try {
      child.process.kill('SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    if (!(await waitForExit(child.exited, 5_000))) {
      fail('Pier process with unreadable identity survived SIGKILL')
    }
    return
  }
  if (!(await signalSessionUntilEmpty(childIdentity, 'SIGTERM', 2_000))) {
    if (!(await signalSessionUntilEmpty(childIdentity, 'SIGKILL', 5_000))) {
      fail(`Pier process session ${childIdentity.sessionId} survived SIGKILL`)
    }
  }
  if (!(await waitForExit(child.exited, 5_000))) {
    fail(`Pier process session ${childIdentity.sessionId} retained child processes`)
  }
}

function requestStop() {
  stopRequested = true
  stopping ??= stopChild()
}

process.on('SIGTERM', requestStop)
process.on('SIGINT', requestStop)

try {
  config = await readControlInput()
  if (
    !config ||
    typeof config !== 'object' ||
    typeof config.command !== 'string' ||
    !Array.isArray(config.args) ||
    typeof config.cwd !== 'string' ||
    !config.env ||
    typeof config.env !== 'object' ||
    typeof config.jobsDirectory !== 'string' ||
    typeof config.jobName !== 'string' ||
    typeof config.dockerCommand !== 'string'
  ) {
    fail('Pier supervisor launch request is malformed')
  }

  const identity = readJson(join(directory, identityFile), 'Pier trial identity')
  if (stopRequested || existsSync(join(directory, stopFile))) {
    const removedContainers = removeTrialContainers(config)
    writeJsonAtomic(directory, terminalFile, {
      schemaVersion: 1,
      kind: 'pier-trial-terminal',
      status: 'stopped',
      processExited: true,
      containersRemoved: true,
      removedContainers,
    })
    process.exitCode = 0
  } else {
    const spawned = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: config.env,
      detached: true,
      stdio: 'ignore',
    })
    if (spawned.pid === undefined) fail('Pier process started without a pid')
    const exited = new Promise((resolveExit) => {
      let settled = false
      spawned.once('error', (error) => {
        if (settled) return
        settled = true
        resolveExit({ code: null, signal: null, error })
      })
      spawned.once('close', (code, signal) => {
        if (settled) return
        settled = true
        resolveExit({ code, signal })
      })
    })
    child = { process: spawned, exited }
    childIdentity = processIdentity(spawned.pid)
    writeJsonAtomic(directory, identityFile, {
      ...identity,
      state: 'running',
      pier: childIdentity,
    })

    if (stopRequested || existsSync(join(directory, stopFile))) {
      stopRequested = true
      stopping = stopChild()
    }
    const exit = await exited
    if (stopping) await stopping
    else await stopChild()
    const removedContainers = removeTrialContainers(config)
    const status = stopRequested ? 'stopped' : exit.code === 0 ? 'completed' : 'failed'
    writeJsonAtomic(directory, terminalFile, {
      schemaVersion: 1,
      kind: 'pier-trial-terminal',
      status,
      processExited: true,
      containersRemoved: true,
      removedContainers,
      exitCode: exit.code,
      signal: exit.signal,
      ...(exit.error ? { error: 'Pier process failed to start' } : {}),
      ...(status === 'failed' && !exit.error
        ? { error: `Pier process exited ${exit.signal ?? exit.code ?? 'without status'}` }
        : {}),
    })
  }
} catch (error) {
  const cleanupErrors = []
  try {
    requestStop()
    if (stopping) await stopping
  } catch (cleanup) {
    cleanupErrors.push(cleanup)
  }
  if (config) {
    try {
      removeTrialContainers(config)
    } catch (cleanup) {
      cleanupErrors.push(cleanup)
    }
  }
  writeJsonAtomic(directory, terminalFile, {
    schemaVersion: 1,
    kind: 'pier-trial-terminal',
    status: 'failed',
    processExited: !childIdentity || !processMatches(childIdentity),
    containersRemoved: cleanupErrors.length === 0,
    error: `${error instanceof Error ? error.message : String(error)}${
      cleanupErrors.length > 0
        ? `; cleanup failed: ${cleanupErrors.map((item) => item?.message ?? String(item)).join('; ')}`
        : ''
    }`,
  })
  process.exitCode = 1
}
