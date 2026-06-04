/**
 * ProgramBench adapter (facebookresearch/ProgramBench) — cleanroom
 * reverse-engineering: rebuild a black-box executable's behavior from scratch.
 * The agent is given only the gold `./executable` (run-only) + stripped docs and
 * must produce a `submission.tar.gz` whose `./compile.sh` builds an `./executable`
 * with identical observable behavior. Judge = the official `programbench`
 * harness: it extracts the submission, runs compile.sh in the per-task cleanroom
 * Docker image, then runs the HIDDEN behavioral pytest suites (pulled via
 * `programbench blob sync`). Score = fraction of non-ignored tests passed
 * (GRADED, applying the tests.json ignore mask); resolved = all non-ignored tests
 * pass. Fully deterministic — no LLM judge.
 *
 * OutputAdapter is stream-only, so the worker emits its codebase as fenced
 * `path:`-prefixed file blocks (including compile.sh); the adapter materializes
 * those into submission.tar.gz. Test execution is delegated to the real
 * `programbench eval`/`info` harness — pytest scoring + the ignore mask are NOT
 * reimplemented here.
 *
 * Requires for a live run: the bench `.venv` with `programbench` installed +
 * Docker on linux/amd64 (per-task `<image>:task_cleanroom` images) + HF access for
 * the hidden test blobs. For offline/CI listing set PROGRAMBENCH_FIXTURES=1 to load
 * the committed instance ids (bench/fixtures/programbench.json); judging still
 * needs the harness + Docker and fails loud without them — never a fabricated score.
 */

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot, preflightVenvImports, runVenvScriptStdin } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'programbench.json')

const TESTS_DATASET = 'programbench/ProgramBench-Tests'
const TREE_API = `https://huggingface.co/api/datasets/${TESTS_DATASET}/tree/main`

interface PbFixture {
  instance_id: string
  image_name: string
  note?: string
}

interface PbMeta {
  instanceId: string
  imageName: string
}

const PROMPT = [
  'This is a cleanroom reverse-engineering task. You are given a compiled black-box `./executable` (run-only) and stripped documentation in the workspace.',
  'Write an ORIGINAL codebase from scratch that, when built, produces an `./executable` with byte-for-byte identical observable behavior (stdout/stderr/exit codes/filesystem effects) to the original. You may run `./executable` to probe its behavior.',
  'You MUST include a `./compile.sh` at the workspace root that builds your source into `./executable` at the workspace root.',
  'Emit your COMPLETE submission as the LAST thing in your reply: one fenced block per file, each opening fence line being exactly ```path:<relative/path>``` followed by the file contents, then a closing fence. Include compile.sh and every source file. Nothing after the final closing fence.',
].join('\n')

function fixtureToTask(f: PbFixture): BenchTask {
  const meta: PbMeta = { instanceId: f.instance_id, imageName: f.image_name }
  return {
    id: f.instance_id,
    prompt: PROMPT,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): PbMeta {
  const md = task.metadata
  if (!md || typeof md.instanceId !== 'string') {
    throw new Error(`programbench task ${task.id} missing metadata.instanceId — loadTasks did not populate it`)
  }
  return md as unknown as PbMeta
}

function selectTasks(fixtures: PbFixture[], opts: LoadOptions): BenchTask[] {
  let tasks = fixtures.map(fixtureToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

/** `owner__repo.commit` → DockerHub image name `owner/repo` for `<image>:task_cleanroom`. */
function imageName(instanceId: string): string {
  return instanceId.split('.')[0].replace('__', '/')
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const fixtures = JSON.parse(await readFile(FIXTURES, 'utf8')) as PbFixture[]
  console.warn(
    `[programbench] PROGRAMBENCH_FIXTURES=1 — loading ${fixtures.length} committed instance ids from ${FIXTURES} (no HF tree fetch)`,
  )
  return selectTasks(fixtures, opts)
}

/** Enumerate real instance ids from the HF Tests dataset tree (one dir per
 *  instance). Throws on a non-OK response (fail loud). */
async function fetchInstanceIds(): Promise<PbFixture[]> {
  const res = await fetch(TREE_API)
  if (!res.ok) throw new Error(`programbench tree HTTP ${res.status}: ${TREE_API}`)
  const tree = (await res.json()) as Array<{ path: string; type: string }>
  const ids = tree.filter((e) => e.type === 'directory' && e.path.includes('__')).map((e) => e.path)
  if (ids.length === 0) throw new Error(`programbench: no instance dirs in ${TESTS_DATASET} tree`)
  return ids.map((id) => ({ instance_id: id, image_name: imageName(id) }))
}

/**
 * Run the official programbench harness for one instance over the worker's
 * file-manifest submission. The driver builds the run-dir layout (one folder
 * holding submission.tar.gz), runs `programbench blob sync` + `programbench eval`,
 * then parses <instance_id>.eval.json applying the tests.json ignore mask via
 * `programbench info` logic. Emits {passed,total,resolved} as the last stdout line.
 */
async function runHarness(meta: PbMeta, submission: string): Promise<BenchScore> {
  const judge = join(benchRoot, 'scripts', 'programbench_judge.py')
  let stdout: string
  try {
    // The submission manifest is piped to the driver's stdin via the shared
    // stdin-aware runner — execFile's `input` option is not honored async and
    // hangs the driver's sys.stdin.read() forever.
    stdout = await runVenvScriptStdin(judge, ['--instance', meta.instanceId], submission, { cwd: benchRoot })
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(`programbench harness failed for ${meta.instanceId}: ${(e.message || String(err)).slice(0, 1500)}`)
  }
  const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
    passed?: number
    total?: number
    resolved?: boolean
    error?: string
  }
  if (report.error) throw new Error(`programbench harness error for ${meta.instanceId}: ${report.error}`)
  if (typeof report.passed !== 'number' || typeof report.total !== 'number') {
    throw new Error(`programbench judge returned no {passed,total}: ${stdout.slice(0, 400)}`)
  }
  const score = report.total > 0 ? report.passed / report.total : 0
  return {
    resolved: report.resolved ?? (report.total > 0 && report.passed === report.total),
    score,
    detail: JSON.stringify({ instanceId: meta.instanceId, passed: report.passed, total: report.total }),
  }
}

/**
 * Parse the worker stream into the submission text the driver materializes: the
 * concatenation of every ```path:<p>``` fenced block. Passed through verbatim to
 * the python driver, which tars it. Empty when the worker emitted no file block
 * (fail-closed → the harness scores a missing compile.sh as 0).
 */
export const programbenchSubmissionOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const blocks = [...text.matchAll(/```path:([^\n`]+)\n([\s\S]*?)```/g)]
    if (blocks.length === 0) return ''
    // Re-serialize in the same path:<p> envelope the driver splits on.
    return blocks.map((m) => `===FILE:${m[1].trim()}===\n${m[2]}`).join('\n')
  },
}

export function createProgrambenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.PROGRAMBENCH_FIXTURES === '1'

  return {
    name: 'programbench',
    output: programbenchSubmissionOutput,

    async preflight() {
      await preflightVenvImports({
        modules: ['programbench'],
        requireDocker: true,
        fix:
          `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install programbench ; ` +
          `(2) Docker on linux/amd64 (per-task <image>:task_cleanroom images; will NOT run on ARM) ; ` +
          `(3) HF access for the hidden test blobs (the driver runs \`programbench blob sync\`). ` +
          `Set PROGRAMBENCH_FIXTURES=1 to list the committed instance ids offline.`,
      })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      let fixtures: PbFixture[]
      try {
        fixtures = await fetchInstanceIds()
      } catch (err) {
        console.warn(
          `[programbench] live tree fetch failed (${err instanceof Error ? err.message : err}); falling back to committed fixtures at ${FIXTURES}`,
        )
        return loadFixtures(opts)
      }
      return selectTasks(fixtures, opts)
    },

    async goldArtifact() {
      // The oracle is the original repo's source (stripped from the task image),
      // not redistributable as a portable submission string. Judge correctness is
      // proven by running the real harness on a real solve, not a synthetic gold.
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      return runHarness(meta, artifact)
    },
  }
}
