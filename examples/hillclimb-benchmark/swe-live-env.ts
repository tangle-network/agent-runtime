/**
 * SWE-bench-Live as an `Environment`: real repositories, real issues, refreshed
 * monthly, so a model's training set cannot already contain the fix.
 *
 * Tasks come from the Hugging Face datasets server (no Python, no local
 * dataset). Each `open()` clones the instance's repository at its pinned base
 * commit into a temp workspace; the worker edits it through file tools; the
 * check reads `git diff` and grades the produced state, never the chat text.
 *
 * THE CHECK IS A LOCALIZATION PROXY, stated plainly: a patch passes checks for
 * (1) editing anything at all, (2) staying focused (≤ MAX_CHANGED_FILES files),
 * (3) touching at least one file the reference fix touched. The reference patch
 * stays in this process — the worker never sees it. The official `resolved`
 * metric needs each instance's Docker test harness; for that fidelity, run
 * `bench/src/swe-self-improve.mts` (see bench/HARNESS.md).
 */

import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgenticTask,
  AgenticTool,
  ArtifactHandle,
  Environment,
} from '@tangle-network/agent-runtime/kernel'

const run = promisify(execFile)

const DATASET_ROWS_URL =
  'https://datasets-server.huggingface.co/rows?dataset=SWE-bench-Live%2FSWE-bench-Live&config=default&split=lite'
const MAX_CHANGED_FILES = 8
const CLONE_TIMEOUT_MS = 180_000
const TOOL_OUTPUT_CAP = 6_000

interface SweLiveMeta {
  repo: string
  baseCommit: string
  /** Files the reference fix modified. Held by the env; never shown to the worker. */
  referenceFiles: string[]
  [key: string]: unknown
}

/**
 * Task supplier for `runStrategyEvolution`: `(offset, n)` maps directly to
 * dataset row offsets, so train `[0, trainN)` and holdout `[trainN, …)` slices
 * are disjoint by construction.
 */
export async function fetchSweLiveTasks(offset: number, n: number): Promise<AgenticTask[]> {
  const response = await fetch(`${DATASET_ROWS_URL}&offset=${offset}&length=${n}`)
  if (!response.ok) {
    throw new Error(`datasets-server ${response.status}: ${await response.text()}`)
  }
  const payload = (await response.json()) as {
    rows: Array<{
      row: {
        repo: string
        instance_id: string
        base_commit: string
        problem_statement: string
        patch: string
      }
    }>
  }
  if (payload.rows.length < n) {
    throw new Error(`requested ${n} instances at offset ${offset}, got ${payload.rows.length}`)
  }
  return payload.rows.map(({ row }) => {
    const referenceFiles = [...row.patch.matchAll(/^diff --git a\/(.+?) b\//gm)]
      .map((m) => m[1])
      .filter((file): file is string => file !== undefined)
    if (referenceFiles.length === 0) {
      throw new Error(`${row.instance_id}: reference patch names no files — cannot grade`)
    }
    const meta: SweLiveMeta = {
      repo: row.repo,
      baseCommit: row.base_commit,
      referenceFiles,
    }
    return {
      id: row.instance_id,
      userPrompt: [
        `Repository: ${row.repo}. You are working in a checkout of this repository.`,
        'Fix the issue below by editing the repository files with the tools.',
        'Make a focused change; do not rewrite unrelated files.',
        'Reply DONE when your edits are complete.',
        '',
        '--- ISSUE ---',
        row.problem_statement.slice(0, 6_000),
      ].join('\n'),
      meta,
    }
  })
}

const workspaces = new Map<string, { root: string; meta: SweLiveMeta }>()

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: root,
    timeout: CLONE_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

/** Resolve a worker-supplied path inside the workspace or throw. */
function inside(root: string, path: string): string {
  const abs = resolve(root, path)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes the workspace: ${path}`)
  }
  return abs
}

const cap = (text: string): string =>
  text.length > TOOL_OUTPUT_CAP ? `${text.slice(0, TOOL_OUTPUT_CAP)}\n…truncated` : text

export const sweLiveEnv: Environment = {
  name: 'swe-bench-live',

  async open(task) {
    const meta = task.meta as SweLiveMeta
    const root = await mkdtemp(join(tmpdir(), 'swe-live-'))
    // Shallow-fetch exactly the pinned base commit — no full clone, no branch drift.
    await git(root, ['init', '-q'])
    await git(root, ['remote', 'add', 'origin', `https://github.com/${meta.repo}.git`])
    await git(root, ['fetch', '-q', '--depth', '1', 'origin', meta.baseCommit])
    await git(root, ['checkout', '-q', '--detach', 'FETCH_HEAD'])
    const id = `${task.id}-${Math.random().toString(36).slice(2, 8)}`
    workspaces.set(id, { root, meta })
    return { id, surface: 'swe-bench-live' } satisfies ArtifactHandle
  },

  async tools(): Promise<AgenticTool[]> {
    const str = (description: string) => ({ type: 'string', description })
    return [
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'List one directory of the repository.',
          parameters: {
            type: 'object',
            properties: {
              path: str('Directory path relative to the repository root; "." for the root.'),
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read one file from the repository.',
          parameters: {
            type: 'object',
            properties: { path: str('File path relative to the repository root.') },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_code',
          description: 'Search tracked files for a fixed string (git grep -n -F).',
          parameters: {
            type: 'object',
            properties: { pattern: str('The exact text to search for.') },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Replace the full contents of one file (creates it when missing).',
          parameters: {
            type: 'object',
            properties: {
              path: str('File path relative to the repository root.'),
              content: str('The complete new file contents.'),
            },
            required: ['path', 'content'],
          },
        },
      },
    ]
  },

  async call(handle, name, args) {
    const ws = workspaces.get(handle.id)
    if (!ws) return 'ERROR: workspace closed'
    try {
      if (name === 'list_dir') {
        const entries = await readdir(inside(ws.root, String(args.path)), { withFileTypes: true })
        return cap(
          entries
            .filter((e) => e.name !== '.git')
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .join('\n') || '(empty)',
        )
      }
      if (name === 'read_file') {
        return cap(await readFile(inside(ws.root, String(args.path)), 'utf8'))
      }
      if (name === 'search_code') {
        try {
          return cap(await git(ws.root, ['grep', '-n', '-F', String(args.pattern)]))
        } catch {
          return 'no matches'
        }
      }
      if (name === 'write_file') {
        const abs = inside(ws.root, String(args.path))
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, String(args.content), 'utf8')
        return `wrote ${String(args.path)}`
      }
      return `ERROR: unknown tool ${name}`
    } catch (err) {
      return `ERROR: ${(err as Error).message}`
    }
  },

  // The deployable check, graded from PRODUCED STATE (git diff), not chat text.
  async score(_task, handle) {
    const ws = workspaces.get(handle.id)
    if (!ws) return { passes: 0, total: 3, errored: 0 }
    const diff = await git(ws.root, ['diff', '--name-only'])
    const changed = diff.split('\n').filter(Boolean)
    const overlaps = changed.some((file) => ws.meta.referenceFiles.includes(file))
    const checks = [
      changed.length > 0, // the worker edited the repository at all
      changed.length > 0 && changed.length <= MAX_CHANGED_FILES, // focused, not shotgun
      overlaps, // touched at least one file the reference fix touched
    ]
    return { passes: checks.filter(Boolean).length, total: checks.length, errored: 0 }
  },

  async close(handle) {
    const ws = workspaces.get(handle.id)
    if (!ws) return
    workspaces.delete(handle.id)
    await rm(ws.root, { recursive: true, force: true })
  },
}
