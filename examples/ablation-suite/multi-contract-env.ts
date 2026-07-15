/**
 * multi-contract-env — a LONG-HORIZON coding task: build ONE Python client module that correctly
 * integrates N external services, each with its CURRENT, non-default contract (auth scheme,
 * endpoint version, pagination), graded end-to-end. This is where web-search value COMPOUNDS:
 * a small per-contract edge (search lifts p_no→p_yes on getting one contract right) becomes p^N
 * end-to-end, detectable at low n. Compounding AMPLIFIES a real per-step edge; it can't invent one.
 *
 * ABLATION DELTA: the `search` config toggles a `web_search` tool (you.com via the Tangle router).
 * Native read/write/run_tests/bash stay ON in BOTH arms — additive isolation (both can work; only
 * one can also search). run_tests gives the worker per-vendor PASS/FAIL (realistic integration
 * feedback: "novu FAIL" → go discover novu's current contract) WITHOUT revealing the hidden
 * assertions — so it's a genuine multi-round task, not a leak.
 *
 * PRE-REGISTERED (encoded, not narrated past): calibrate no-search FIRST — end-to-end resolve MUST
 * be <40% or the task is too easy (harden it). Success = search−nosearch resolve delta, paired
 * bootstrap 95% CI excludes 0, n≥20, GLM-5.2. Kill = worker never calls web_search (arm invalid).
 *
 * Reuses the SAME self-contained mock+pytest graders VB web-grounded already ships (each boots its
 * own mock, injects base_url, tests one exported function of solution.py). See extract-contracts.mjs.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgenticSurface,
  AgenticTask,
  AgenticTool,
  ArtifactHandle,
  SurfaceScore,
} from '../../src/runtime/strategy.js'

const here = dirname(fileURLToPath(import.meta.url))
interface Contract {
  vendor: string
  fn: string
  testFile: string
  signature: string
  graderB64: string
}
const CONTRACTS: Contract[] = JSON.parse(
  readFileSync(join(here, 'fixtures', 'multi-contract', 'contracts.json'), 'utf8'),
)

const SOLUTION_REL = join('solution', 'solution.py')
// Global web_search firing counter (the strategy opens its OWN handle, so per-handle counting
// misses it). Reset per arm via resetSearchCalls(); read after each task for the firing gate.
let searchCallTotal = 0
export function resetSearchCalls(): void {
  searchCallTotal = 0
}
export function searchCalls(): number {
  return searchCallTotal
}
const dirsByHandle = new Map<string, string>()

/** Run one vendor's self-contained grader (boots its own mock) against the worker's solution.py. */
function runGrader(dir: string, c: Contract): boolean {
  const graderDir = join(dir, '.vb_grader')
  mkdirSync(graderDir, { recursive: true })
  writeFileSync(join(graderDir, c.testFile), Buffer.from(c.graderB64, 'base64'))
  try {
    const out = execFileSync(
      'python3',
      [
        '-m',
        'pytest',
        '-q',
        '--tb=no',
        '--color=no',
        '-p',
        'no:cacheprovider',
        join('.vb_grader', c.testFile),
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, VB_SOLUTION_ROOT: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    return /(\d+) passed/.test(out) && !/(\d+) failed/.test(out) && !/(\d+) error/.test(out)
  } catch (e) {
    const out = (e as { stdout?: string }).stdout ?? ''
    return /(\d+) passed/.test(out) && !/failed|error/.test(out)
  }
}

async function youSearch(query: string): Promise<string> {
  const key = process.env.TANGLE_API_KEY
  if (!key) return 'web_search error: TANGLE_API_KEY unset'
  try {
    const res = await fetch('https://router.tangle.tools/v1/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, provider: 'you' }),
    })
    const j = (await res.json()) as {
      data?: Array<{ title?: string; url?: string; snippet?: string }>
    }
    const rows = (j.data ?? [])
      .slice(0, 6)
      .map((r, i) => `${i + 1}. ${r.title ?? ''}\n   ${r.url ?? ''}\n   ${r.snippet ?? ''}`)
    return rows.length ? rows.join('\n') : `web_search: no results for ${JSON.stringify(query)}`
  } catch (err) {
    return `web_search error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export function makeMultiContractSurface(opts: { search: boolean }): AgenticSurface {
  const name = `multi-contract-${CONTRACTS.length}${opts.search ? '+search' : ''}`
  return {
    name,
    async open(task: AgenticTask): Promise<ArtifactHandle> {
      const dir = mkdtempSync(join(tmpdir(), 'multi-contract-'))
      mkdirSync(join(dir, 'solution'), { recursive: true })
      writeFileSync(
        join(dir, SOLUTION_REL),
        `# Implement the ${CONTRACTS.length} client functions below.\n`,
      )
      const id = `${name}:${task.id}:${dirsByHandle.size}`
      dirsByHandle.set(id, dir)
      return { id, surface: name, ctx: { dir } }
    },
    async tools(): Promise<AgenticTool[]> {
      const base: AgenticTool[] = [
        {
          type: 'function',
          function: {
            name: 'write_file',
            description: 'Write a file (path relative to project root, e.g. solution/solution.py).',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file in the project.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Run a shell command in the project root (e.g. python -c, curl).',
            parameters: {
              type: 'object',
              properties: { cmd: { type: 'string' } },
              required: ['cmd'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'run_tests',
            description:
              'Run the hidden integration graders and get per-vendor PASS/FAIL for your solution/solution.py.',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ]
      if (opts.search)
        base.push({
          type: 'function',
          function: {
            name: 'web_search',
            description:
              'Search the live web (you.com) for the CURRENT contract of an API. Use it to discover current auth schemes, endpoint versions, and pagination that you cannot recall.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        })
      return base
    },
    async call(
      handle: ArtifactHandle,
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const dir = (handle.ctx as { dir: string }).dir
      if (toolName === 'web_search') {
        searchCallTotal += 1
        return youSearch(String(args.query ?? ''))
      }
      if (toolName === 'write_file') {
        const p = join(dir, String(args.path))
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, String(args.content ?? ''))
        return `wrote ${args.path}`
      }
      if (toolName === 'read_file') {
        const p = join(dir, String(args.path))
        return existsSync(p)
          ? readFileSync(p, 'utf8').slice(0, 20_000)
          : `no such file: ${args.path}`
      }
      if (toolName === 'bash') {
        try {
          return execFileSync('bash', ['-lc', String(args.cmd)], {
            cwd: dir,
            encoding: 'utf8',
            timeout: 60_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).slice(0, 8_000)
        } catch (e) {
          return (
            ((e as { stdout?: string; stderr?: string }).stdout ?? '') +
            ((e as { stderr?: string }).stderr ?? '')
          )
        }
      }
      if (toolName === 'run_tests') {
        const lines = CONTRACTS.map((c) => `${c.vendor}: ${runGrader(dir, c) ? 'PASS' : 'FAIL'}`)
        const passed = lines.filter((l) => l.endsWith('PASS')).length
        return `${passed}/${CONTRACTS.length} vendor contracts pass.\n${lines.join('\n')}\n(A FAIL means that vendor's current contract — auth/endpoint/version — is wrong. Discover the current contract and fix it.)`
      }
      return `unknown tool: ${toolName}`
    },
    async score(_task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore> {
      const dir = (handle.ctx as { dir: string }).dir
      let passes = 0
      for (const c of CONTRACTS) if (runGrader(dir, c)) passes++
      return { passes, total: CONTRACTS.length, errored: 0 }
    },
    async close(handle: ArtifactHandle): Promise<void> {
      const dir = (handle.ctx as { dir: string }).dir
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
      dirsByHandle.delete(handle.id)
    },
  }
}

/** The task: build one solution.py with all N current-contract clients. */
export function multiContractTasks(offset: number, n: number): Promise<AgenticTask[]> {
  const fnList = CONTRACTS.map((c) => `  - ${c.vendor}: \`${c.signature}\``).join('\n')
  const userPrompt = [
    `Build a single Python module \`solution/solution.py\` that implements a client for ${CONTRACTS.length} different SaaS APIs. Export EXACTLY these functions:`,
    fnList,
    ``,
    `Each function receives \`base_url\` (the API server root, injected at call time — append the CURRENT path to it, never hardcode the host) and \`api_key\`. Make REAL HTTP requests (use \`requests\` or \`urllib\`); no mocks, no hardcoded data.`,
    ``,
    `Each vendor's CURRENT contract is non-default and may have changed recently — the exact Authorization scheme (many are NOT \`Bearer\`), the endpoint path/version, and pagination. Do NOT rely on a from-memory integration; verify each vendor's current contract before wiring it.`,
    ``,
    `Call \`run_tests\` to see which vendors pass. Iterate until all ${CONTRACTS.length} pass. A vendor FAILS if its auth scheme, endpoint version, or response handling is wrong.`,
  ].join('\n')
  const systemPrompt =
    'You are a senior integrations engineer. Build a correct, real multi-API client. Use your tools; verify current contracts; iterate on run_tests until every vendor passes.'
  return Promise.resolve(
    Array.from({ length: n }, (_, i) => ({
      id: `multi-contract-${offset + i}`,
      systemPrompt,
      userPrompt,
    })),
  )
}
