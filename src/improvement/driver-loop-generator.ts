/**
 * `driverLoopGenerator` — the driver→worker `CandidateGenerator`: the build
 * loop run by the ATOM instead of the canned respawn.
 *
 * `agenticGenerator` steers with three hardcoded conditions picking a canned
 * note (`EMPTY_TREE_NOTE` / `failureNote`) and respawns. This generator swaps
 * that respawn brain for a real driver: an LLM on the canonical tool-loop seam
 * (`runBrainLoop` + `ToolLoopChat` — the exact loop `driverAgent` runs its
 * brain on) that AUTHORS each worker instruction, OBSERVES what the session
 * actually produced (diff, files, verifier output), RATES it, and DECIDES
 * refine / re-scope / decompose — prompted with the senior scientific-method
 * doctrine (`buildDriverSystem`).
 *
 * The worker stays the proven primitive: `runLocalHarness` in the candidate
 * worktree, same as `agenticGenerator` — only the brain between sessions
 * changes. The worktree machinery (`worktreeBuildCandidate`) and verifiers
 * (`commandVerifier` / `mcpServeVerifier`) are reused verbatim.
 *
 * Completion-oracle invariant (the supervisor doctrine, kept): the driver's
 * prose NEVER decides the outcome. After the loop, code re-checks ground
 * truth — tree dirty, raw-trace evidence present, verifier green — and only
 * that decides `applied`. A driver that claims success over a failing verifier
 * produces a discarded candidate, not a shipped one.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { type LocalHarness, runLocalHarness } from '../mcp/local-harness'
import { runBrainLoop, type ToolLoopChat } from '../runtime/tool-loop'
import {
  defaultBuildPrompt,
  rawTraceEvidenceProblem,
  requiresRawTraceEvidence,
  summarizeFindings,
  type Verifier,
  worktreeChangedPaths,
} from './agentic-generator'
import type { CandidateGenerator } from './improvement-driver'
import { buildDriverSystem, researchDriverNote } from './optimizer-prompt'

export interface DriverLoopGeneratorOptions {
  /** The driver-LLM seam — ONE inference turn over the conversation + tool specs (the canonical
   *  `ToolLoopChat`, same seam as `driverAgent`): `routerBrain(cfg)` in production, a scripted
   *  mock in tests. */
  brain: ToolLoopChat
  /** Local coding harness the driver's worker sessions run in the worktree. Default `claude`. */
  harness?: LocalHarness
  /** Per-worker-session wall-clock timeout (ms). Default = `runLocalHarness` default (5m). */
  timeoutMs?: number
  /** Build the driver's task briefing (domain framing + method + findings) — the same senior
   *  prompt the worker path uses (`toolBuildPrompt` / `mcpBuildPrompt`). The driver reads it and
   *  folds what each worker needs into its instruction. Default `defaultBuildPrompt`. */
  buildPrompt?: (args: { report: unknown; findings: AnalystFinding[] }) => string
  /** Verify the worktree (the intrinsic check). Exposed to the driver as `run_verifier` AND
   *  re-run by code as the final keep/discard gate. Omitted ⇒ the final gate is dirty-tree only
   *  (legacy `agenticGenerator` behavior sans verifier). */
  verify?: Verifier
  /** Max driver inference turns. Default `max(8, 2 + maxShots * 3)` — room for one
   *  observe/rate/decide cycle per worker session plus orientation. */
  maxTurns?: number
  /** The research seam (adopt-not-build): when set, the driver gets a
   *  `research{query}` tool + the `researchDriverNote` doctrine, so it can
   *  discover an EXISTING external MCP instead of building one. Wire a real
   *  web/search backend here — none is provisioned by default (the build
   *  harness has no live web access yet; flagged). */
  research?: (query: string) => Promise<string>
  /** Test seam — inject the harness runner (defaults to `runLocalHarness`). */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the worktree diff reader (defaults to `git diff` in the worktree). */
  readDiff?: (worktreePath: string) => string
  /** Test seam — inject the changed-paths reader (defaults to `git status --porcelain`). */
  changedPaths?: (worktreePath: string) => string[]
}

const workerOutputTailChars = 2_000
const diffMaxChars = 6_000
const readFileDefaultBytes = 8_192
const researchResultMaxChars = 8_000

/** Driver→worker `CandidateGenerator`: an LLM driver on the canonical tool-loop authors, observes, rates, and steers coding-harness sessions in the worktree until the verifier passes or the session budget is spent. */
export function driverLoopGenerator(opts: DriverLoopGeneratorOptions): CandidateGenerator {
  const harness = opts.harness ?? 'claude'
  const buildPrompt = opts.buildPrompt ?? defaultBuildPrompt
  const run = opts.runHarness ?? runLocalHarness
  const changed = opts.changedPaths ?? worktreeChangedPaths
  const readDiff = opts.readDiff ?? worktreeDiff
  const verify = opts.verify

  return {
    kind: `driver-loop:${harness}`,
    async generate({ worktreePath, report, findings, maxShots, signal }) {
      signal.throwIfAborted()
      const briefing = buildPrompt({ report, findings })
      const needsRawTraceEvidence = requiresRawTraceEvidence(findings)
      const sessionCap = Math.max(1, maxShots)
      let sessionsUsed = 0

      // Ground-truth verification shared by the driver's `run_verifier` tool and the final
      // code-owned gate — ONE definition of "delivered" so the driver can never see a different
      // check than the one that decides the keep.
      const groundVerify = async (): Promise<{ ok: boolean; feedback?: string }> => {
        signal.throwIfAborted()
        if (changed(worktreePath).length === 0) {
          return { ok: false, feedback: 'the working tree has no changes — nothing to verify' }
        }
        if (needsRawTraceEvidence) {
          const problem = rawTraceEvidenceProblem(worktreePath, findings)
          if (problem) return { ok: false, feedback: problem }
        }
        if (!verify) {
          return { ok: true, feedback: 'no verifier configured: a dirty tree is the candidate' }
        }
        const result = await verify(worktreePath, signal)
        signal.throwIfAborted()
        return result
      }

      const execute = async (name: string, args: Record<string, unknown>): Promise<string> => {
        signal.throwIfAborted()
        switch (name) {
          case 'run_worker': {
            const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : ''
            if (instruction.length === 0) {
              return 'error: run_worker requires a non-empty `instruction`'
            }
            if (sessionsUsed >= sessionCap) {
              return `error: worker-session budget exhausted (${sessionsUsed}/${sessionCap} used). Inspect and verify what exists, then stop with your final assessment.`
            }
            sessionsUsed += 1
            const result = await run({
              harness,
              cwd: worktreePath,
              taskPrompt: instruction,
              ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
              signal,
            })
            signal.throwIfAborted()
            if (result.aborted) {
              throw new Error('driverLoopGenerator: worker session was cancelled by the caller')
            }
            return JSON.stringify({
              session: `${sessionsUsed}/${sessionCap}`,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              aborted: result.aborted ?? false,
              killedBySignal: result.killedBySignal,
              durationMs: result.durationMs,
              changedPaths: changed(worktreePath),
              stdoutTail: tail(result.stdout, workerOutputTailChars),
              stderrTail: tail(result.stderr, workerOutputTailChars),
            })
          }
          case 'inspect_worktree': {
            const paths = changed(worktreePath)
            const diff = truncate(readDiff(worktreePath), diffMaxChars)
            return JSON.stringify({
              changedPaths: paths,
              diff:
                diff.length > 0
                  ? diff
                  : '(no tracked-file diff — new files are untracked; read_file them)',
            })
          }
          case 'read_file':
            return readWorktreeFile(worktreePath, args)
          case 'research': {
            if (!opts.research) return 'error: research tool is not provisioned in this run'
            const query = typeof args.query === 'string' ? args.query.trim() : ''
            if (query.length === 0) return 'error: research requires a non-empty `query`'
            const result = await opts.research(query)
            signal.throwIfAborted()
            return truncate(result, researchResultMaxChars)
          }
          case 'run_verifier': {
            const result = await groundVerify()
            return JSON.stringify({
              ok: result.ok,
              feedback: truncate(result.feedback ?? '', 4_000),
            })
          }
          default:
            return `error: unknown tool: ${name}`
        }
      }

      await runBrainLoop({
        chat: opts.brain,
        tools: opts.research ? [...driverToolSpecs, researchToolSpec] : driverToolSpecs,
        execute,
        initialMessages: [
          {
            role: 'system',
            content: opts.research
              ? `${buildDriverSystem}\n\n${researchDriverNote}`
              : buildDriverSystem,
          },
          {
            role: 'user',
            content: [
              `THE BUILD BRIEF (the contract your workers must satisfy — fold what each needs into its instruction; workers never see this brief):`,
              '',
              briefing,
              '',
              `Worker-session budget: ${sessionCap}. The worktree is a fresh checkout at ${worktreePath}.`,
            ].join('\n'),
          },
        ],
        maxTurns: opts.maxTurns ?? Math.max(8, 2 + sessionCap * 3),
        hooks: { stopBefore: () => signal.aborted },
      })
      signal.throwIfAborted()

      // The completion oracle: the driver stopped (or ran out of turns) — ground truth decides.
      const verdict = await groundVerify()
      signal.throwIfAborted()
      if (!verdict.ok) return { applied: false, summary: '' }
      return { applied: true, summary: summarizeFindings(findings) }
    },
  }
}

const driverToolSpecs = [
  {
    type: 'function' as const,
    function: {
      name: 'run_worker',
      description:
        'Run ONE coding-harness session in the worktree with your instruction as its entire goal. The worktree persists between sessions. Sessions are capped — author each instruction richly (outcome, context, placement, the check it is held to).',
      parameters: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: 'The complete, self-contained goal for this worker session.',
          },
        },
        required: ['instruction'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'inspect_worktree',
      description:
        'Current git state of the worktree: changed paths + the tracked-file diff (truncated). New untracked files show in changedPaths only — read_file them.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read one file from the worktree (paths are worktree-relative).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Worktree-relative file path.' },
          maxBytes: { type: 'number', description: 'Byte cap (default 8192).' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_verifier',
      description:
        'Run the intrinsic check of the surface (compile+tests / boot-and-probe). Its result — not your judgment — decides whether the candidate is kept.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

/** Only offered when `opts.research` is wired — a tool the driver cannot call
 *  must never appear in its tool list. */
const researchToolSpec = {
  type: 'function' as const,
  function: {
    name: 'research',
    description:
      'Search external sources (MCP registries, vendor docs) for an EXISTING server that closes the capability gap — the adopt-not-build check. Returns text findings.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What capability / server to search for.' },
      },
      required: ['query'],
    },
  },
}

/** `git diff` over the worktree (tracked files). Fails loud like `worktreeChangedPaths` — a git
 *  fault on a fresh checkout is a broken setup, not an empty diff. */
function worktreeDiff(worktreePath: string): string {
  const result = spawnSync('git', ['diff'], { cwd: worktreePath, encoding: 'utf-8' })
  if (result.error) {
    throw new Error(
      `driverLoopGenerator: git diff failed to spawn in ${worktreePath}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `driverLoopGenerator: git diff exited ${result.status} in ${worktreePath}: ${result.stderr.trim()}`,
    )
  }
  return result.stdout
}

/** Bounded, worktree-jailed file read for the driver's `read_file`. A path escaping the worktree
 *  is refused (the driver only rates work in the candidate tree; it has no business elsewhere). */
function readWorktreeFile(worktreePath: string, args: Record<string, unknown>): string {
  const rel = typeof args.path === 'string' ? args.path : ''
  if (rel.length === 0) return 'error: read_file requires `path`'
  const root = resolve(worktreePath)
  const target = resolve(root, rel)
  if (target !== root && !target.startsWith(root + sep)) {
    return `error: path escapes the worktree: ${rel}`
  }
  const maxBytes =
    typeof args.maxBytes === 'number' && args.maxBytes > 0
      ? Math.min(args.maxBytes, 65_536)
      : readFileDefaultBytes
  try {
    const size = statSync(target).size
    const body = readFileSync(target, 'utf-8').slice(0, maxBytes)
    return size > maxBytes ? `${body}\n… (${size - maxBytes} bytes truncated)` : body
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`
  }
}

function tail(s: string, n: number): string {
  const trimmed = s.trim()
  return trimmed.length <= n ? trimmed : `…${trimmed.slice(-n)}`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
