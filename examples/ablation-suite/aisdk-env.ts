/**
 * aisdk-env — a long-horizon coding task on a genuinely POST-CUTOFF contract: build a working tool
 * for the CURRENT Vercel `ai` SDK (v7). The coder's training knows v4, where the tool schema field
 * was `parameters:`; v5+ renamed it to `inputSchema:`, so v4-shaped code no longer type-checks. The
 * grader is the TypeScript compiler itself against the installed ai@7 — no rubric, the compiler is
 * the judge. This is the first web-grounded task where the knowledge is genuinely absent from the
 * coder AND search returns it AND a real compiler catches the difference.
 *
 * ABLATION DELTA: `search` toggles a `web_search` tool (you.com via the Tangle router). read/write/
 * run_tests (= tsc, returns the compiler errors as feedback) stay ON in both arms — additive
 * isolation. The NO-SEARCH arm is the control: with compiler feedback but no web, does the coder
 * recover the current contract on its own, or stay stuck on its v4 prior?
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  AgenticSurface,
  AgenticTask,
  AgenticTool,
  ArtifactHandle,
  SurfaceScore,
} from '../../src/runtime/strategy.js'

// Prebuilt template with node_modules { ai@7, zod, typescript } + the proven tsc invocation. Each
// workspace symlinks its node_modules and .bin from here so there is no per-task npm install.
const TEMPLATE =
  process.env.AISDK_TEMPLATE ??
  '/tmp/claude-1000/-home-drew-code-blueprint-agent/8b62a3c4-97a5-46cd-92bf-5a4f3bf95f75/scratchpad/aisdk-probe'
const TSC = join(TEMPLATE, 'node_modules', '.bin', 'tsc')
const TSC_ARGS = [
  '--ignoreConfig',
  '--pretty',
  'false',
  '--noEmit',
  '--strict',
  '--skipLibCheck',
  '--moduleResolution',
  'bundler',
  '--module',
  'esnext',
  '--target',
  'es2022',
]

// Each task is a structurally-required rename in the current ai SDK: the coder's v4 memory writes a
// name the compiler now rejects, and the task cannot be completed without the current name — so a
// pass means the coder produced the current API, not a lucky stub. `starter` fails to compile (an
// unedited attempt is a fail); `check` compiles solution.ts with a real use of the export.
interface SdkTask {
  key: string
  systemPrompt: string
  userPrompt: string
  starter: string
  check: string
}

const SDK_TASKS: SdkTask[] = [
  {
    key: 'tool',
    systemPrompt:
      'You are a senior TypeScript engineer. Build code for the CURRENT version of the library, not the version you remember.',
    userPrompt:
      'Edit `solution.ts` so it exports a tool named `weatherTool`, built with the CURRENT `ai` package via its `tool()` helper: a description, a zod schema for a `location: string` input, and an `execute` returning a string. The tool() schema field may have been renamed since your training — if run_tests fails, the current field name differs from what you wrote.',
    starter: `import { tool } from 'ai'\nimport { z } from 'zod'\n// Build weatherTool with the CURRENT ai SDK tool() helper.\nexport const weatherTool = tool({})\n`,
    check: `import { generateText } from 'ai'\nimport { weatherTool } from './solution'\nexport async function _check() {\n  return generateText({ model: 'gpt' as unknown as never, tools: { weather: weatherTool }, prompt: 'x' })\n}\n`,
  },
  {
    key: 'stream',
    systemPrompt:
      'You are a senior TypeScript engineer. Build code for the CURRENT version of the library, not the version you remember.',
    userPrompt:
      'Edit `solution.ts` so it exports a function `handler(): Response` that calls `streamText` (model can be `"x" as any`, prompt `"hi"`) and returns its HTTP streaming Response for a chat UI. The method on the streamText result that returns this Response may have been renamed since your training — if run_tests fails, the current method name differs from what you wrote.',
    starter: `import { streamText } from 'ai'\n// Return the streamText result's HTTP streaming Response.\nexport function handler(): Response {\n}\n`,
    check: `import { handler } from './solution'\nexport const _r: Response = handler()\n`,
  },
]

function taskSpec(id: string): SdkTask {
  const key = id.split('#')[0]
  const spec = SDK_TASKS.find((t) => t.key === key) ?? SDK_TASKS[0]
  if (!spec) throw new Error(`aisdk-env: no task spec for '${id}'`)
  return spec
}

let searchCallTotal = 0
export function resetSearchCalls(): void {
  searchCallTotal = 0
}
export function searchCalls(): number {
  return searchCallTotal
}

function ensureTemplate(): void {
  if (!existsSync(join(TEMPLATE, 'node_modules', 'ai'))) {
    throw new Error(
      `AISDK_TEMPLATE has no node_modules/ai — install ai@7 zod typescript in ${TEMPLATE}`,
    )
  }
}

/** tsc the workspace (solution.ts + check.ts). Returns { pass, output } — output is the feedback. */
function compile(dir: string): { pass: boolean; output: string } {
  try {
    execFileSync(TSC, [...TSC_ARGS, 'solution.ts', 'check.ts'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { pass: true, output: 'tsc: 0 errors — compiles against the current ai SDK.' }
  } catch (e) {
    const out =
      ((e as { stdout?: string }).stdout ?? '') + ((e as { stderr?: string }).stderr ?? '')
    return { pass: false, output: out.trim().slice(0, 2_000) || 'tsc failed (no output)' }
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

export function makeAiSdkSurface(opts: { search: boolean }): AgenticSurface {
  const name = `aisdk-v7${opts.search ? '+search' : ''}`
  return {
    name,
    async open(task: AgenticTask): Promise<ArtifactHandle> {
      ensureTemplate()
      const spec = taskSpec(task.id)
      const dir = mkdtempSync(join(tmpdir(), 'aisdk-'))
      symlinkSync(join(TEMPLATE, 'node_modules'), join(dir, 'node_modules'))
      writeFileSync(join(dir, 'solution.ts'), spec.starter)
      writeFileSync(join(dir, 'check.ts'), spec.check)
      return { id: `${name}:${task.id}`, surface: name, ctx: { dir } }
    },
    async tools(): Promise<AgenticTool[]> {
      const base: AgenticTool[] = [
        {
          type: 'function',
          function: {
            name: 'write_file',
            description: 'Write a file (path relative to project root, e.g. solution.ts).',
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
      ]
      // NO_RUN_TESTS models the no-oracle regime (one-shot / non-executing agent): remove the
      // compiler-feedback tool so the coder cannot trial-and-error to the current API. This is
      // where web search should stop being redundant.
      if (!process.env.NO_RUN_TESTS)
        base.push({
          type: 'function',
          function: {
            name: 'run_tests',
            description:
              'Type-check solution.ts against the installed ai SDK and get the compiler errors.',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        })
      if (opts.search)
        base.push({
          type: 'function',
          function: {
            name: 'web_search',
            description:
              'Search the live web (you.com) for the CURRENT ai SDK API you cannot recall (e.g. the tool() schema field name).',
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
      if (toolName === 'run_tests') {
        const { pass, output } = compile(dir)
        return pass
          ? output
          : `tsc FAILED — fix the tool definition for the current SDK:\n${output}`
      }
      return `unknown tool: ${toolName}`
    },
    async score(_task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore> {
      const dir = (handle.ctx as { dir: string }).dir
      return { passes: compile(dir).pass ? 1 : 0, total: 1, errored: 0 }
    },
    async close(handle: ArtifactHandle): Promise<void> {
      const dir = (handle.ctx as { dir: string }).dir
      if (process.env.AISDK_KEEP) {
        console.error(`  kept workspace: ${dir}`)
        return
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    },
  }
}

// Cycle the verified tasks so n tasks spread evenly across the distinct renames (n=12 → 6 each),
// proving the search effect is not specific to one API change.
export function aiSdkTasks(n: number): Promise<AgenticTask[]> {
  return Promise.resolve(
    Array.from({ length: n }, (_, i) => {
      const spec = SDK_TASKS[i % SDK_TASKS.length]
      if (!spec) throw new Error('aisdk-env: SDK_TASKS is empty')
      return {
        id: `${spec.key}#${i}`,
        systemPrompt: spec.systemPrompt,
        userPrompt: spec.userPrompt,
      }
    }),
  )
}
