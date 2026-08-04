/**
 * Commit0 as an `Environment` — the HARD test (docs/research/long-horizon-benchmark-survey.md:
 * the survey's top pick, graded + natively multi-stage). The agent implements an entire
 * stubbed Python library so its existing test suite passes.
 *
 * Off-box construction (routes around the sandbox platform exactly like the EOPS gym):
 *   open()  — clone the stub repo at base_commit into a tmpdir, start a PERSISTENT
 *             python:<ver>-slim container with the workspace mounted, `pip install -e .`
 *             + pytest once. The container is the artifact; it carries across shots.
 *   tools() — list_files / read_file / write_file / run_tests. The worker EDITS SOURCE
 *             VIA TOOLS (no diff emission). write_file is path-jailed and refuses the
 *             test dir — the agent cannot edit the check.
 *   score() — the repo's OWN pytest suite (passed/total), parsed from a quiet run inside
 *             the container. Deterministic, deployable. (The official commit0 harness can
 *             re-validate a winner from `git diff` later; it is not in the loop.)
 *   close() — kill the container, remove the tmpdir.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticSurface, AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/kernel'

const exec = promisify(execFile)

export interface Commit0Row {
  instance_id: string
  repo: string
  base_commit: string
  setup: { install: string; pre_install?: string[] | null; python: string; specification?: string }
  src_dir: string
  test: { test_cmd: string; test_dir: string }
}

interface Ws {
  dir: string
  container: string
  row: Commit0Row
}
const workspaces = new Map<string, Ws>()

async function dockerExec(container: string, cmd: string, timeoutMs = 180_000): Promise<{ out: string; code: number }> {
  try {
    const r = await exec('docker', ['exec', container, 'bash', '-lc', cmd], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
    return { out: `${r.stdout}\n${r.stderr}`.trim(), code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number }
    return { out: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim(), code: typeof err.code === 'number' ? err.code : 1 }
  }
}

/** Parse pytest's summary tail ("X passed", "Y failed", "Z errors") into counts. */
function parsePytest(out: string): { passed: number; failed: number } {
  const grab = (re: RegExp) => {
    const m = out.match(re)
    return m ? Number(m[1]) : 0
  }
  return {
    passed: grab(/(\d+) passed/),
    failed: grab(/(\d+) failed/) + grab(/(\d+) error/),
  }
}

export function rowToTask(row: Commit0Row): AgenticTask {
  return {
    id: row.instance_id,
    userPrompt:
      'You are a senior Python engineer implementing a stubbed library so its existing test suite passes. ' +
      'Workflow: list_files and read the tests + stubs to learn the required behavior, write COMPLETE implementations ' +
      `with write_file (source under ${row.src_dir} only — the test dir is read-only), then run_tests and fix failures. ` +
      'Iterate until the suite passes. Reply DONE only when run_tests shows no failures.\n\n' +
      `Implement the stubbed library "${row.repo}". The public functions/classes under \`${row.src_dir}\` have empty bodies. ` +
      `Make the existing tests under \`${row.test.test_dir}\` pass.${row.setup.specification ? ` Spec: ${row.setup.specification}` : ''}`,
    meta: { instanceId: row.instance_id },
  }
}

export function createCommit0Environment(rows: Commit0Row[]): AgenticSurface {
  const byId = new Map(rows.map((r) => [r.instance_id, r]))
  return {
    name: 'commit0',
    async open(task) {
      const row = byId.get(task.id)
      if (!row) throw new Error(`commit0-env: unknown task ${task.id}`)
      const dir = mkdtempSync(join(tmpdir(), 'c0-'))
      await exec('git', ['clone', '--quiet', `https://github.com/${row.repo}.git`, dir], { timeout: 120_000 })
      await exec('git', ['-C', dir, 'checkout', '--quiet', row.base_commit], { timeout: 60_000 })
      const container = `c0-${task.id.replace(/[^a-z0-9]/gi, '-')}-${Math.random().toString(36).slice(2, 8)}`
      await exec('docker', ['run', '-d', '--name', container, '--cpus=2', '--memory=2g', '-v', `${dir}:/w`, '-w', '/w', `python:${row.setup.python}-slim`, 'sleep', 'infinity'], { timeout: 120_000 })
      for (const pre of row.setup.pre_install ?? []) await dockerExec(container, pre, 300_000)
      const setup = await dockerExec(container, `${row.setup.install} && pip install -q pytest`, 600_000)
      if (setup.code !== 0) {
        await dockerExec(container, 'find /w -mindepth 1 -delete', 60_000).catch(() => {})
        await exec('docker', ['rm', '-f', container]).catch(() => {})
        rmSync(dir, { recursive: true, force: true })
        throw new Error(`commit0-env setup failed for ${task.id}: ${setup.out.slice(-300)}`)
      }
      const handle: ArtifactHandle = { id: container, surface: 'commit0' }
      workspaces.set(container, { dir, container, row })
      return handle
    },

    async tools(task) {
      const row = byId.get(task.id)
      const src = row?.src_dir ?? 'src/'
      const tests = row?.test.test_dir ?? 'tests/'
      return [
        { type: 'function', function: { name: 'list_files', description: `List the repo's source (${src}) and test (${tests}) files.`, parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'read_file', description: 'Read a file from the repo (bounded).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
        { type: 'function', function: { name: 'write_file', description: `Write COMPLETE file contents (source under ${src} only; the test dir is read-only).`, parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
        { type: 'function', function: { name: 'run_tests', description: 'Run the existing test suite; returns the pytest summary + failure tails.', parameters: { type: 'object', properties: {} } } },
      ] satisfies AgenticTool[]
    },

    async call(handle, name, args) {
      const ws = workspaces.get(handle.id)
      if (!ws) return 'ERROR: workspace closed'
      const jail = (p: string): string | null => {
        const norm = p.replace(/^\.?\//, '')
        if (norm.includes('..') || norm.startsWith('/')) return null
        return norm
      }
      if (name === 'list_files') {
        const r = await dockerExec(ws.container, `find ${ws.row.src_dir} ${ws.row.test.test_dir} -name '*.py' | head -80`, 30_000)
        return r.out.slice(0, 2000)
      }
      if (name === 'read_file') {
        const p = jail(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        const r = await dockerExec(ws.container, `cat ${JSON.stringify(p)}`, 30_000)
        return r.code === 0 ? r.out.slice(0, 8000) : `ERROR: ${r.out.slice(0, 200)}`
      }
      if (name === 'write_file') {
        const p = jail(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        if (p.startsWith(ws.row.test.test_dir.replace(/^\.?\//, ''))) return 'ERROR: the test dir is read-only — implement the source, not the tests'
        const content = String(args.content ?? '')
        const b64 = Buffer.from(content, 'utf8').toString('base64')
        const r = await dockerExec(ws.container, `mkdir -p $(dirname ${JSON.stringify(p)}) && echo '${b64}' | base64 -d > ${JSON.stringify(p)}`, 30_000)
        return r.code === 0 ? `wrote ${p} (${content.length} chars)` : `ERROR: ${r.out.slice(0, 200)}`
      }
      if (name === 'run_tests') {
        // `-o addopts=` neutralizes repo-configured pytest plugins (e.g. wcwidth's tox.ini
        // demands pytest-cov) that aren't installed and would usage-error before any test runs.
        const r = await dockerExec(ws.container, `${ws.row.test.test_cmd} ${ws.row.test.test_dir} -q --tb=line -p no:cacheprovider -o addopts= 2>&1 | tail -30`, 240_000)
        return r.out.slice(0, 2500)
      }
      return `ERROR: unknown tool ${name}`
    },

    async score(_task, handle) {
      const ws = workspaces.get(handle.id)
      if (!ws) return { passes: 0, total: 0, errored: 1 }
      const r = await dockerExec(ws.container, `${ws.row.test.test_cmd} ${ws.row.test.test_dir} -q --tb=no -p no:cacheprovider -o addopts= 2>&1 | tail -5`, 240_000)
      const { passed, failed } = parsePytest(r.out)
      const total = passed + failed
      return total > 0 ? { passes: passed, total, errored: 0 } : { passes: 0, total: 0, errored: 1 }
    },

    async close(handle) {
      const ws = workspaces.get(handle.id)
      if (!ws) return
      workspaces.delete(handle.id)
      // The container ran as root, so its writes on the bind mount are root-owned and the
      // host rmSync would EACCES — wipe the mount from INSIDE the container first.
      await dockerExec(ws.container, 'find /w -mindepth 1 -delete', 60_000).catch(() => {})
      await exec('docker', ['rm', '-f', ws.container]).catch(() => {})
      rmSync(ws.dir, { recursive: true, force: true })
    },
  }
}
