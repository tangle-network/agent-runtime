/**
 * SWE-bench Verified as an `AgenticSurface` — the PROPER, no-cheating way to run a coding agent on real
 * GitHub bugs through the substrate (`runAgentic`/`runBenchmark`/`runStrategyEvolution` drive the loop;
 * we only provide tools + a deployable score). The agent clones the repo at base_commit, explores +
 * edits SOURCE via tools (never tests — path-jailed), and `score()` grades the resulting `git diff`
 * with the OFFICIAL swebench Docker harness (apply patch → FAIL_TO_PASS + PASS_TO_PASS → resolved).
 *
 * No cheating by construction: the agent never sees the hidden tests or the gold patch (the adapter's
 * prompt is the issue only); `edit_file` refuses test files; the score is a real test run, not a judge.
 *
 * CONTAMINATION CAVEAT: SWE-bench bugs are public GitHub fixes a frontier model may have MEMORIZED.
 * A clean train→holdout split (disjoint instances) rules out adaptive-reuse, but NOT training-data
 * memorization. Always report this; never claim a "clean" frontier number from this arena alone.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticSurface, AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import type { BenchTask } from './benchmarks/types'

const exec = promisify(execFile)
const isTestPath = (p: string) => /(^|\/)(tests?)\//.test(p) || /test_.*\.py$|_test\.py$|conftest\.py$/.test(p)

interface Ws {
  dir: string
  task: BenchTask
}
const workspaces = new Map<string, Ws>()

/** Build the SWE-bench Environment + a DISJOINT-slice task supplier over the Verified split. The
 *  supplier keys tasks by dataset offset so `runStrategyEvolution`'s train [0,trainN) and holdout
 *  [trainN+off,…) never overlap. Verified is loaded once; instances carry their repo/base_commit. */
export async function createSweBenchEnvironment(poolN = 80): Promise<{
  environment: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  adapter: ReturnType<typeof createSweBenchAdapter>
}> {
  const adapter = createSweBenchAdapter()
  const pool = await adapter.loadTasks({ limit: poolN, split: 'test' })
  const byId = new Map(pool.map((t) => [t.id, t]))

  const environment: AgenticSurface = {
    name: 'swe-bench-verified',
    async open(task) {
      const bt = byId.get(task.id)
      if (!bt) throw new Error(`swe-bench-env: unknown task ${task.id}`)
      const md = bt.metadata as Record<string, string>
      const dir = mkdtempSync(join(tmpdir(), 'swe-'))
      await exec('git', ['clone', '--filter=blob:none', '--no-checkout', '--quiet', `https://github.com/${md.repo}.git`, dir], { timeout: 420_000 })
      await exec('git', ['-C', dir, 'checkout', '--quiet', md.base_commit], { timeout: 300_000 })
      const handle: ArtifactHandle = { id: dir, surface: 'swe-bench-verified' }
      workspaces.set(dir, { dir, task: bt })
      return handle
    },
    async tools() {
      return [
        { type: 'function', function: { name: 'list_files', description: 'List source files under a repo subdirectory (recursive, bounded). "" = repo root.', parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] } } },
        { type: 'function', function: { name: 'read_file', description: 'Read a repo file by path.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
        { type: 'function', function: { name: 'edit_file', description: 'Surgical fix: replace the EXACT old_string (must occur once — copy whitespace precisely) with new_string in a SOURCE file. Minimal changes, never whole-file rewrites. Test files are rejected.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
      ] satisfies AgenticTool[]
    },
    async call(handle, name, args) {
      const ws = workspaces.get(handle.id)
      if (!ws) return 'ERROR: workspace closed'
      const safe = (p: string): string | null => {
        const n = p.replace(/^\.?\//, '')
        return n.includes('..') || n.startsWith('/') ? null : n
      }
      if (name === 'list_files') {
        const sub = safe(String(args.dir ?? '')) ?? ''
        const root = join(ws.dir, sub)
        if (!existsSync(root)) return `(no such path: ${sub})`
        const out: string[] = []
        const walk = (d: string, depth: number) => {
          if (depth > 2 || out.length > 240) return
          let entries: string[] = []
          try {
            entries = readdirSync(d)
          } catch {
            return
          }
          for (const e of entries) {
            if (e.startsWith('.') || e === 'node_modules' || e === '__pycache__') continue
            const p = join(d, e)
            let isDir = false
            try {
              isDir = statSync(p).isDirectory()
            } catch {
              continue
            }
            out.push(p.slice(ws.dir.length + 1) + (isDir ? '/' : ''))
            if (isDir) walk(p, depth + 1)
          }
        }
        walk(root, 0)
        return out.slice(0, 240).join('\n') || '(empty)'
      }
      if (name === 'read_file') {
        const p = safe(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        try {
          const c = readFileSync(join(ws.dir, p), 'utf8')
          return c.length > 24_000 ? `${c.slice(0, 24_000)}\n...[truncated]` : c
        } catch (e) {
          return `(error: ${(e as Error).message})`
        }
      }
      if (name === 'edit_file') {
        const p = safe(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        if (isTestPath(p)) return 'REJECTED: editing test files is forbidden (the evaluation runs hidden tests).'
        const oldStr = String(args.old_string ?? '')
        const newStr = String(args.new_string ?? '')
        let content: string
        try {
          content = readFileSync(join(ws.dir, p), 'utf8')
        } catch (e) {
          return `(cannot read ${p}: ${(e as Error).message})`
        }
        if (!oldStr) return 'ERROR: old_string is empty.'
        const count = content.split(oldStr).length - 1
        if (count === 0) return `ERROR: old_string not found in ${p}. read_file it and copy EXACT text.`
        if (count > 1) return `ERROR: old_string appears ${count}× in ${p} — add surrounding context to make it unique.`
        writeFileSync(join(ws.dir, p), content.replace(oldStr, newStr))
        return `edited ${p}: replaced 1 occurrence`
      }
      return `ERROR: unknown tool ${name}`
    },
    async score(_task, handle): Promise<SurfaceScore> {
      const ws = workspaces.get(handle.id)
      if (!ws) return { passes: 0, total: 1, errored: 1 }
      let patch = ''
      try {
        const r = await exec('git', ['-C', ws.dir, 'diff'], { maxBuffer: 20_000_000, timeout: 60_000 })
        patch = r.stdout
      } catch {
        patch = ''
      }
      if (!patch.trim()) return { passes: 0, total: 1, errored: 0 }
      try {
        const s = await adapter.judge(ws.task, patch)
        return { passes: s.resolved ? 1 : 0, total: 1, errored: 0 }
      } catch {
        return { passes: 0, total: 1, errored: 1 }
      }
    },
    async close(handle) {
      const ws = workspaces.get(handle.id)
      if (!ws) return
      workspaces.delete(handle.id)
      rmSync(ws.dir, { recursive: true, force: true })
    },
  }

  const tasks = async (offset: number, n: number): Promise<AgenticTask[]> => {
    const slice = pool.slice(offset, offset + n)
    if (slice.length < n) throw new Error(`swe-bench-env: pool exhausted at offset ${offset} (need ${n}, have ${slice.length}; raise poolN)`)
    return slice.map((bt) => ({
      id: bt.id,
      systemPrompt:
        'You are a senior engineer fixing a real bug in the checked-out repository. Work PERSISTENTLY and do not ' +
        'stop early: use list_files + read_file to explore BROADLY (read many candidate files — the bug is rarely in ' +
        'the first file you open), trace the issue to its root cause, then fix it with edit_file. You MUST make at ' +
        'least one edit_file call — never finish with prose alone or without attempting a fix. Make a MINIMAL surgical ' +
        'change (a few lines, like a real PR), source only (test files are rejected). If an edit_file fails (old_string ' +
        'not unique/found), read the file again and retry with exact text. Keep going until you have made your best fix.',
      userPrompt: bt.prompt,
      meta: { instanceId: bt.id },
    }))
  }

  return { environment, tasks, adapter }
}
