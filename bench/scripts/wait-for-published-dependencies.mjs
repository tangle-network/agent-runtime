import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localDependencyProtocol = /^(?:catalog|file|link|patch|portal|workspace):/

export const DEFAULT_TIMEOUT_MS = 20 * 60_000
export const DEFAULT_INTERVAL_MS = 15_000

export function collectRequiredTangleDependencies(packageJson) {
  const dependencies = new Map()
  const sections = [
    ['dependencies', packageJson.dependencies],
    ['peerDependencies', packageJson.peerDependencies],
  ]

  for (const [section, entries] of sections) {
    for (const [name, spec] of Object.entries(entries ?? {})) {
      if (!name.startsWith('@tangle-network/')) continue
      if (
        section === 'peerDependencies' &&
        packageJson.peerDependenciesMeta?.[name]?.optional === true
      ) {
        continue
      }
      if (
        typeof spec !== 'string' ||
        spec.length === 0 ||
        localDependencyProtocol.test(spec)
      ) {
        throw new Error(`${packageJson.name} has no published ${name} dependency version`)
      }

      const previous = dependencies.get(name)
      if (previous && previous !== spec) {
        throw new Error(`${packageJson.name} declares conflicting versions for ${name}`)
      }
      dependencies.set(name, spec)
    }
  }

  return [...dependencies]
    .map(([name, spec]) => ({ name, spec }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function waitForPublishedDependencies(
  dependencies,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    probe = probeNpm,
    sleep = (milliseconds) =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    now = Date.now,
    report = console.log,
  } = {},
) {
  requirePositiveInteger('timeoutMs', timeoutMs)
  requirePositiveInteger('intervalMs', intervalMs)
  if (dependencies.length === 0) {
    throw new Error('agent-bench has no required published @tangle-network dependencies')
  }

  const startedAt = now()
  const deadline = startedAt + timeoutMs
  let attempts = 0
  let pending = dependencies.map((dependency) => ({ dependency, detail: 'not checked' }))

  report(
    `Waiting up to ${formatDuration(timeoutMs)} for ${dependencies.length} published dependencies`,
  )

  while (true) {
    if (attempts > 0 && now() >= deadline) {
      throw timeoutError(timeoutMs, attempts, pending)
    }

    attempts += 1
    const results = await Promise.all(
      pending.map(async ({ dependency }) => {
        try {
          const result = await probe(dependency, {
            timeoutMs: Math.max(1, deadline - now()),
          })
          return result.available
            ? undefined
            : { dependency, detail: result.detail ?? 'not available' }
        } catch (error) {
          return {
            dependency,
            detail: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
    pending = results.filter((result) => result !== undefined)

    if (pending.length === 0) {
      return { attempts, elapsedMs: now() - startedAt }
    }
    if (now() >= deadline) {
      throw timeoutError(timeoutMs, attempts, pending)
    }

    const delayMs = Math.min(intervalMs, deadline - now())
    report(
      `Attempt ${attempts}: ${pending.length}/${dependencies.length} unavailable: ${pending
        .map(({ dependency }) => `${dependency.name}@${dependency.spec}`)
        .join(', ')}. Retrying in ${formatDuration(delayMs)}`,
    )
    await sleep(delayMs)
  }
}

async function probeNpm(dependency, { timeoutMs }) {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      [
        'view',
        `${dependency.name}@${dependency.spec}`,
        'version',
        '--json',
        '--prefer-online',
      ],
      {
        env: { ...process.env, npm_config_color: 'false' },
        maxBuffer: 1024 * 1024,
        timeout: Math.min(30_000, timeoutMs),
      },
    )
    const version = JSON.parse(stdout)
    const available =
      (typeof version === 'string' && version.length > 0) ||
      (Array.isArray(version) && version.length > 0)
    return available
      ? { available: true }
      : { available: false, detail: 'npm returned no matching version' }
  } catch (error) {
    return { available: false, detail: summarizeCommandError(error) }
  }
}

async function readPackedBenchManifest() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-dependencies-'))
  try {
    await execFileAsync('pnpm', ['pack', '--pack-destination', scratch], {
      cwd: benchDir,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    })
    const tarballs = (await readdir(scratch)).filter((name) => name.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      throw new Error(`expected one packed agent-bench tarball, found ${tarballs.length}`)
    }
    const { stdout } = await execFileAsync(
      'tar',
      ['-xOzf', path.join(scratch, tarballs[0]), 'package/package.json'],
      { maxBuffer: 1024 * 1024, timeout: 30_000 },
    )
    return JSON.parse(stdout)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function timeoutError(timeoutMs, attempts, pending) {
  const details = pending
    .map(
      ({ dependency, detail }) =>
        `- ${dependency.name}@${dependency.spec}: ${firstLine(detail)}`,
    )
    .join('\n')
  return new Error(
    `Timed out after ${formatDuration(timeoutMs)} and ${attempts} attempts waiting for ${pending.length} published dependencies:\n${details}`,
  )
}

function summarizeCommandError(error) {
  if (!(error instanceof Error)) return String(error)
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
  return firstLine(stderr || error.message)
}

function firstLine(value) {
  return String(value).split(/\r?\n/, 1)[0]
}

function formatDuration(milliseconds) {
  if (milliseconds >= 60_000 && milliseconds % 60_000 === 0) {
    return `${milliseconds / 60_000}m`
  }
  if (milliseconds >= 1_000 && milliseconds % 1_000 === 0) {
    return `${milliseconds / 1_000}s`
  }
  return `${milliseconds}ms`
}

function requirePositiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function readPositiveInteger(name, fallback) {
  const value = process.env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  requirePositiveInteger(name, parsed)
  return parsed
}

async function main() {
  const packageJson = await readPackedBenchManifest()
  const dependencies = collectRequiredTangleDependencies(packageJson)
  const result = await waitForPublishedDependencies(dependencies, {
    timeoutMs: readPositiveInteger(
      'BENCH_PUBLISH_WAIT_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    ),
    intervalMs: readPositiveInteger(
      'BENCH_PUBLISH_WAIT_INTERVAL_MS',
      DEFAULT_INTERVAL_MS,
    ),
  })
  console.log(
    `Published dependencies ready after ${result.attempts} attempt(s) in ${formatDuration(result.elapsedMs)}: ${dependencies
      .map(({ name, spec }) => `${name}@${spec}`)
      .join(', ')}`,
  )
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
