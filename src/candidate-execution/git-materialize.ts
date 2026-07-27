import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type {
  AgentCandidateCode,
  AgentCandidateGitHubRepository,
  AgentCandidateGitHubResource,
  AgentCandidateWorkspaceManifestMaterial,
} from '@tangle-network/agent-interface'

import { candidateWorkspaceManifest, verifyBytes } from './artifacts'
import { canonicalCandidateBytes } from './digest'
import type { AgentCandidateRepositoryPort } from './types'

interface GitResult {
  stdout: Buffer
  stderr: Buffer
}

export async function verifyCandidateCode(
  code: AgentCandidateCode,
  repositories: AgentCandidateRepositoryPort,
  patchBytes?: Uint8Array,
): Promise<string | undefined> {
  if (code.kind === 'disabled') return undefined
  const repositoryRoot = await verifiedRepositoryRoot(code.repository, repositories)
  await assertCommitAndBaseTree(repositoryRoot, code.baseCommit, code.baseTree)

  if (code.kind === 'no-op') {
    await assertSafeTree(repositoryRoot, code.baseTree)
    return code.baseTree
  }
  if (!patchBytes) throw new Error('git-patch candidate is missing verified patch bytes')

  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-git-'))
  try {
    const indexFile = join(temporary, 'index')
    await runCandidateGit(repositoryRoot, ['read-tree', code.baseTree], undefined, {
      GIT_INDEX_FILE: indexFile,
    })
    await runCandidateGit(
      repositoryRoot,
      ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'],
      patchBytes,
      { GIT_INDEX_FILE: indexFile },
    )
    const candidateTree = (
      await runCandidateGit(repositoryRoot, ['write-tree'], undefined, {
        GIT_INDEX_FILE: indexFile,
      })
    ).stdout
      .toString('utf8')
      .trim()
    if (candidateTree !== code.candidateTree) {
      throw new Error(
        `git patch materialized tree ${candidateTree} does not match ${code.candidateTree}`,
      )
    }
    await assertSafeTree(repositoryRoot, candidateTree)
    return candidateTree
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function readCandidateGitHubResource(
  resource: AgentCandidateGitHubResource,
  repositories: AgentCandidateRepositoryPort,
): Promise<Uint8Array> {
  const repositoryRoot = await verifiedRepositoryRoot(resource.repository, repositories)
  const commitType = (
    await runCandidateGit(repositoryRoot, ['cat-file', '-t', resource.commit])
  ).stdout
    .toString('utf8')
    .trim()
  if (commitType !== 'commit') {
    throw new Error(`GitHub resource commit is not a commit object: ${resource.commit}`)
  }
  const listing = (
    await runCandidateGit(repositoryRoot, ['ls-tree', '-z', resource.commit, '--', resource.path])
  ).stdout
  const entries = parseTreeEntries(listing)
  if (entries.length !== 1 || entries[0]?.path !== resource.path) {
    throw new Error(`GitHub resource path is not one exact file: ${resource.path}`)
  }
  const entry = entries[0]
  if (entry?.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
    throw new Error(`GitHub resource path is not a regular Git blob: ${resource.path}`)
  }
  const bytes = (await runCandidateGit(repositoryRoot, ['cat-file', 'blob', entry.object])).stdout
  verifyBytes(bytes, resource.sha256, resource.byteLength, `GitHub resource ${resource.path}`)
  return Uint8Array.from(bytes)
}

export async function verifyTaskCheckout(
  taskRoot: string,
  expected: { baseCommit: string; baseTree: string },
): Promise<void> {
  const root = resolve(taskRoot)
  const head = (await runCandidateGit(root, ['rev-parse', 'HEAD'])).stdout.toString('utf8').trim()
  if (head !== expected.baseCommit) {
    throw new Error(`task checkout HEAD ${head} does not match ${expected.baseCommit}`)
  }
  const tree = (await runCandidateGit(root, ['rev-parse', 'HEAD^{tree}'])).stdout
    .toString('utf8')
    .trim()
  if (tree !== expected.baseTree) {
    throw new Error(`task checkout base tree ${tree} does not match ${expected.baseTree}`)
  }
}

/**
 * Apply an evaluator-captured binary diff in a detached object database and
 * prove its result tree exactly matches the captured after-state manifest.
 */
export async function verifyTaskOutcomePatch(input: {
  repositoryRoot: string
  baseCommit: string
  baseTree: string
  resultTree: string
  patch: Uint8Array
  afterState: AgentCandidateWorkspaceManifestMaterial
}): Promise<{ resultTree: string; resultCommit: string }> {
  const repositoryRoot = resolve(input.repositoryRoot)
  await verifyTaskCheckout(repositoryRoot, input)
  const gitDir = resolve(
    (await runCandidateGit(repositoryRoot, ['rev-parse', '--absolute-git-dir'])).stdout
      .toString('utf8')
      .trim(),
  )
  if ((await realpath(gitDir)) !== gitDir || gitDir.includes(':')) {
    throw new Error('task Git object store has an unsupported path')
  }
  await assertNoGitIndirection(repositoryRoot, gitDir, 'task repository')

  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-task-outcome-'))
  try {
    const objectDirectory = join(temporary, 'objects')
    const indexFile = join(temporary, 'index')
    await mkdir(objectDirectory)
    const gitEnvironment = {
      GIT_INDEX_FILE: indexFile,
      GIT_OBJECT_DIRECTORY: objectDirectory,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, 'objects'),
    }
    await runCandidateGit(repositoryRoot, ['read-tree', input.baseTree], undefined, gitEnvironment)
    if (input.patch.byteLength > 0) {
      await runCandidateGit(
        repositoryRoot,
        ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'],
        input.patch,
        gitEnvironment,
      )
    }
    const resultTree = (
      await runCandidateGit(repositoryRoot, ['write-tree'], undefined, gitEnvironment)
    ).stdout
      .toString('utf8')
      .trim()
    if (resultTree !== input.resultTree) {
      throw new Error(
        `task outcome patch materialized tree ${resultTree} does not match ${input.resultTree}`,
      )
    }
    await assertSafeTree(repositoryRoot, resultTree, gitEnvironment)
    const observed = await workspaceManifestFromGitTree(repositoryRoot, resultTree, gitEnvironment)
    if (
      !Buffer.from(canonicalCandidateBytes(observed)).equals(
        Buffer.from(canonicalCandidateBytes(input.afterState)),
      )
    ) {
      throw new Error('task outcome after-state does not match the materialized result tree')
    }
    const resultCommit = (
      await runCandidateGit(
        repositoryRoot,
        ['commit-tree', resultTree, '-p', input.baseCommit],
        Buffer.from('candidate task outcome\n', 'utf8'),
        {
          ...gitEnvironment,
          GIT_AUTHOR_NAME: 'Tangle Evaluator',
          GIT_AUTHOR_EMAIL: 'evaluator@tangle.tools',
          GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
          GIT_COMMITTER_NAME: 'Tangle Evaluator',
          GIT_COMMITTER_EMAIL: 'evaluator@tangle.tools',
          GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
        },
      )
    ).stdout
      .toString('utf8')
      .trim()
    const committedTree = (
      await runCandidateGit(
        repositoryRoot,
        ['rev-parse', `${resultCommit}^{tree}`],
        undefined,
        gitEnvironment,
      )
    ).stdout
      .toString('utf8')
      .trim()
    if (committedTree !== resultTree) {
      throw new Error('task outcome evaluator commit does not bind the verified result tree')
    }
    return { resultTree, resultCommit }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function verifiedRepositoryRoot(
  repository: AgentCandidateGitHubRepository,
  repositories: AgentCandidateRepositoryPort,
): Promise<string> {
  const repositoryRoot = resolve(await repositories.resolve(repository))
  const rootStats = await stat(repositoryRoot)
  if (!rootStats.isDirectory()) throw new Error('candidate repository path is not a directory')

  const origin = (await runCandidateGit(repositoryRoot, ['remote', 'get-url', 'origin'])).stdout
    .toString('utf8')
    .trim()
  const actual = parseGitHubRemote(origin)
  if (!actual || actual.owner !== repository.owner || actual.repo !== repository.repo) {
    throw new Error(
      `local repository origin ${origin || '<missing>'} does not match github.com/${repository.owner}/${repository.repo}`,
    )
  }

  const gitDirText = (
    await runCandidateGit(repositoryRoot, ['rev-parse', '--absolute-git-dir'])
  ).stdout
    .toString('utf8')
    .trim()
  const gitDir = resolve(gitDirText)
  await assertNoGitIndirection(repositoryRoot, gitDir, 'candidate repository')
  return repositoryRoot
}

export async function assertNoGitIndirection(
  repositoryRoot: string,
  gitDir: string,
  label: string,
): Promise<void> {
  const replacements = (
    await runCandidateGit(repositoryRoot, ['for-each-ref', '--format=%(refname)', 'refs/replace'])
  ).stdout
    .toString('utf8')
    .trim()
  if (replacements) throw new Error(`${label} contains Git replace refs`)
  const commonDir = resolve(
    repositoryRoot,
    (await runCandidateGit(repositoryRoot, ['rev-parse', '--git-common-dir'])).stdout
      .toString('utf8')
      .trim(),
  )
  if ((await realpath(commonDir)) !== commonDir || commonDir.includes(':')) {
    throw new Error(`${label} Git common directory has an unsupported path`)
  }
  for (const objectRoot of new Set([gitDir, commonDir])) {
    for (const name of ['alternates', 'http-alternates']) {
      const path = join(objectRoot, 'objects', 'info', name)
      try {
        const contents = await readFile(path, 'utf8')
        if (contents.trim()) throw new Error(`${label} uses forbidden Git ${name}`)
      } catch (error) {
        if (!isNoEntry(error)) throw error
      }
    }
  }
}

async function assertCommitAndBaseTree(
  repositoryRoot: string,
  commit: string,
  expectedTree: string,
): Promise<void> {
  const type = (await runCandidateGit(repositoryRoot, ['cat-file', '-t', commit])).stdout
    .toString('utf8')
    .trim()
  if (type !== 'commit') throw new Error(`candidate base object is not a commit: ${commit}`)
  const actualTree = (
    await runCandidateGit(repositoryRoot, ['rev-parse', `${commit}^{tree}`])
  ).stdout
    .toString('utf8')
    .trim()
  if (actualTree !== expectedTree) {
    throw new Error(`candidate base commit tree ${actualTree} does not match ${expectedTree}`)
  }
}

async function assertSafeTree(
  repositoryRoot: string,
  tree: string,
  environment: Record<string, string> = {},
): Promise<void> {
  const listing = (
    await runCandidateGit(
      repositoryRoot,
      ['ls-tree', '-rz', '--full-tree', tree],
      undefined,
      environment,
    )
  ).stdout
  const entries = parseTreeEntries(listing)
  if (entries.length === 0) throw new Error('candidate Git tree cannot be empty')
  for (const entry of entries) {
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
      throw new Error(
        `candidate Git tree contains a symlink, submodule, or non-blob: ${entry.path}`,
      )
    }
    assertSafeGitPath(entry.path)
  }
}

async function workspaceManifestFromGitTree(
  repositoryRoot: string,
  tree: string,
  environment: Record<string, string>,
): Promise<AgentCandidateWorkspaceManifestMaterial> {
  return candidateWorkspaceManifest(
    await readCandidateGitTreeFiles(repositoryRoot, tree, environment),
  )
}

export async function readCandidateGitTreeFiles(
  repositoryRoot: string,
  tree: string,
  environment: Record<string, string> = {},
  limits?: { maxFiles: number; maxFileBytes: number; maxTotalFileBytes: number },
): Promise<Array<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>> {
  const listing = (
    await runCandidateGit(
      repositoryRoot,
      ['ls-tree', '-rzl', '--full-tree', tree],
      undefined,
      environment,
    )
  ).stdout
  const files: Array<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }> = []
  const entries = parseTreeEntries(listing)
  if (limits && entries.length > limits.maxFiles) {
    throw new Error('candidate Git tree exceeds maxFiles')
  }
  let totalBytes = 0
  for (const entry of entries) {
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
      throw new Error(`candidate Git tree contains a non-regular file: ${entry.path}`)
    }
    assertSafeGitPath(entry.path)
    if (entry.size === undefined) {
      throw new Error(`candidate Git tree is missing blob size: ${entry.path}`)
    }
    if (limits && entry.size > limits.maxFileBytes) {
      throw new Error(`candidate Git tree file exceeds maxFileBytes: ${entry.path}`)
    }
    totalBytes += entry.size
    if (limits && totalBytes > limits.maxTotalFileBytes) {
      throw new Error('candidate Git tree exceeds maxTotalFileBytes')
    }
    const bytes = (
      await runCandidateGit(
        repositoryRoot,
        ['cat-file', 'blob', entry.object],
        undefined,
        environment,
      )
    ).stdout
    if (bytes.byteLength !== entry.size) {
      throw new Error(`candidate Git blob size changed: ${entry.path}`)
    }
    files.push({
      path: entry.path,
      mode: entry.mode === '100755' ? 0o755 : 0o644,
      bytes: Uint8Array.from(bytes),
    })
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

function parseTreeEntries(bytes: Uint8Array): Array<{
  mode: string
  type: string
  object: string
  size?: number
  path: string
}> {
  const raw = Buffer.from(bytes)
  const decoded = raw.toString('utf8')
  if (!Buffer.from(decoded, 'utf8').equals(raw)) {
    throw new Error('candidate Git tree contains a non-UTF-8 path')
  }
  const rows = decoded.split('\0').filter(Boolean)
  return rows.map((row) => {
    const tab = row.indexOf('\t')
    const header = row.slice(0, tab).split(' ').filter(Boolean)
    const path = row.slice(tab + 1)
    const [mode, type, object, sizeText] = header
    if (tab < 1 || !mode || !type || !object || !path) {
      throw new Error('malformed Git tree entry')
    }
    const size = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : undefined
    if (size !== undefined && !Number.isSafeInteger(size)) {
      throw new Error('candidate Git tree entry size exceeds the safe integer range')
    }
    return { mode, type, object, ...(size === undefined ? {} : { size }), path }
  })
}

function assertSafeGitPath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    hasControlCharacter(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    path.split('/')[0]?.toLowerCase() === '.git'
  ) {
    throw new Error(`candidate Git tree contains an unsafe path: ${path}`)
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function parseGitHubRemote(value: string): { owner: string; repo: string } | undefined {
  const match = value.match(
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/,
  )
  if (!match?.[1] || !match[2]) return undefined
  return { owner: match[1], repo: match[2] }
}

export async function runCandidateGit(
  repositoryRoot: string,
  args: string[],
  input?: Uint8Array,
  extraEnv: Record<string, string> = {},
): Promise<GitResult> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  ) as Record<string, string>
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
    ...extraEnv,
  })
  const fullArgs = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'protocol.file.allow=never',
    '-C',
    repositoryRoot,
    ...args,
  ]
  return await new Promise((resolveResult, reject) => {
    const child = spawn('git', fullArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr)
      if (code !== 0) {
        reject(
          new Error(
            `git ${args[0] ?? '<command>'} failed (${signal ?? code}): ${err.toString('utf8').trim()}`,
          ),
        )
        return
      }
      resolveResult({ stdout: out, stderr: err })
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

function isNoEntry(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
