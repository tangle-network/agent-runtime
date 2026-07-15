/** Reconstruct a runtime task outcome from Pier's evaluator-captured binary patch. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  type AgentCandidateExecutorTaskOutcomeCapture,
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspaceFiles,
} from '@tangle-network/agent-runtime/candidate-execution'

interface GitResult {
  readonly stdout: Buffer
  readonly stderr: Buffer
}

/** Apply the official patch in an isolated Git object directory and capture its exact tree. */
export async function capturePierTaskOutcome(input: {
  readonly repositoryRoot: string
  readonly baseCommit: string
  readonly baseTree: string
  readonly patch: Uint8Array
  readonly signal?: AbortSignal
  readonly artifactPersistence?: {
    readonly executionId: string
    readonly outputArtifacts: AgentCandidateOutputArtifactPort
  }
}): Promise<AgentCandidateExecutorTaskOutcomeCapture> {
  input.signal?.throwIfAborted()
  const repositoryRoot = resolve(input.repositoryRoot)
  const head = (await git(repositoryRoot, ['rev-parse', 'HEAD'], undefined, {}, input.signal)).stdout
    .toString('utf8')
    .trim()
  const headTree = (
    await git(repositoryRoot, ['rev-parse', 'HEAD^{tree}'], undefined, {}, input.signal)
  ).stdout
    .toString('utf8')
    .trim()
  if (head !== input.baseCommit || headTree !== input.baseTree) {
    throw new Error('Pier task outcome repository drifted from its signed base')
  }
  const gitDir = resolve(
    (
      await git(repositoryRoot, ['rev-parse', '--absolute-git-dir'], undefined, {}, input.signal)
    ).stdout
      .toString('utf8')
      .trim(),
  )
  if ((await realpath(gitDir)) !== gitDir || gitDir.includes(':')) {
    throw new Error('Pier task outcome Git directory is unsupported')
  }
  const replacements = (
    await git(
      repositoryRoot,
      ['for-each-ref', '--format=%(refname)', 'refs/replace'],
      undefined,
      {},
      input.signal,
    )
  ).stdout
    .toString('utf8')
    .trim()
  if (replacements) throw new Error('Pier task outcome repository contains Git replace refs')

  const temporary = await mkdtemp(join(tmpdir(), 'pier-task-outcome-'))
  try {
    const objectDirectory = join(temporary, 'objects')
    const indexFile = join(temporary, 'index')
    await mkdir(objectDirectory)
    const environment = {
      GIT_INDEX_FILE: indexFile,
      GIT_OBJECT_DIRECTORY: objectDirectory,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, 'objects'),
    }
    await git(repositoryRoot, ['read-tree', input.baseTree], undefined, environment, input.signal)
    const patch = Uint8Array.from(input.patch)
    if (patch.byteLength > 0) {
      await git(
        repositoryRoot,
        ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'],
        patch,
        environment,
        input.signal,
      )
    }
    const resultTree = (
      await git(repositoryRoot, ['write-tree'], undefined, environment, input.signal)
    ).stdout
      .toString('utf8')
      .trim()
    const entries = parseTreeEntries(
      (
        await git(
          repositoryRoot,
          ['ls-tree', '-rz', '--full-tree', resultTree],
          undefined,
          environment,
          input.signal,
        )
      ).stdout,
    )
    if (entries.length === 0) throw new Error('Pier task outcome tree cannot be empty')
    const files = await Promise.all(
      entries.map(async (entry) => {
        if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
          throw new Error(`Pier task outcome contains a non-regular entry: ${entry.path}`)
        }
        return {
          path: safeGitPath(entry.path),
          mode: entry.mode === '100755' ? (0o755 as const) : (0o644 as const),
          bytes: (
            await git(
              repositoryRoot,
              ['cat-file', 'blob', entry.object],
              undefined,
              environment,
              input.signal,
            )
          ).stdout,
        }
      }),
    )
    // The executor outcome must still return exact bytes; the runtime verifies
    // and persists its final task references after this capture completes.
    const captured = await captureAgentCandidateWorkspaceFiles(files, {
      ...(input.artifactPersistence
        ? {
            artifactPersistence: {
              ...input.artifactPersistence,
              ...(input.signal ? { signal: input.signal } : {}),
            },
          }
        : {}),
    })
    return {
      resultTree,
      afterState: captured.snapshot.material,
      archive: captured.archive,
      gitDiff: patch,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function parseTreeEntries(bytes: Uint8Array): Array<{
  readonly mode: string
  readonly type: string
  readonly object: string
  readonly path: string
}> {
  const raw = Buffer.from(bytes)
  const decoded = raw.toString('utf8')
  if (!Buffer.from(decoded, 'utf8').equals(raw)) {
    throw new Error('Pier task outcome contains a non-UTF-8 path')
  }
  return decoded
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t')
      const [mode, type, object] = row.slice(0, tab).split(' ')
      const path = row.slice(tab + 1)
      if (tab < 1 || !mode || !type || !object || !path) {
        throw new Error('Pier task outcome contains a malformed Git entry')
      }
      return { mode, type, object, path }
    })
}

function safeGitPath(path: string): string {
  const parts = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts[0]?.toLowerCase() === '.git'
  ) {
    throw new Error(`Pier task outcome contains an unsafe Git path: ${path}`)
  }
  return path
}

async function git(
  repositoryRoot: string,
  args: readonly string[],
  input: Uint8Array | undefined,
  extraEnvironment: Readonly<Record<string, string>>,
  signal: AbortSignal | undefined,
): Promise<GitResult> {
  signal?.throwIfAborted()
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  ) as Record<string, string>
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
    ...extraEnvironment,
  })
  return await new Promise((resolveResult, reject) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'protocol.file.allow=never',
        '-C',
        repositoryRoot,
        ...args,
      ],
      { env: environment, stdio: ['pipe', 'pipe', 'pipe'], signal },
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > 64 * 1024 * 1024) {
        child.kill('SIGKILL')
        reject(new Error(`git ${args[0] ?? '<command>'} exceeded the output limit`))
        return
      }
      target.push(Buffer.from(chunk))
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code, childSignal) => {
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr)
      if (code !== 0) {
        reject(
          new Error(
            `git ${args[0] ?? '<command>'} failed (${childSignal ?? code}): ${err.toString('utf8').trim()}`,
          ),
        )
        return
      }
      resolveResult({ stdout: out, stderr: err })
    })
    child.stdin.end(input)
  })
}
