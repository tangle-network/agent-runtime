/**
 * A declared check: the one frozen evaluator program that decides "done" for a run, named by
 * digest, run by Runtime in a fresh box on the check account.
 *
 * The same program is read three times (discovery `docs/38-one-loop-and-continuation.md`, section
 * 1): inside the run on every `submit_result` and at a turn end with no accepted result, after the
 * run to score it, and after each version to rank versions. Before this, each play wrote its own
 * check as Lab code in a method bundle — an exact-check judge, a sealed-cases judge, a product
 * judge — and the in-run check was a separate, weaker "shape and persistence" test, so 22 directors
 * passed their own check and then failed the outside one.
 *
 * The program prints one agent-eval `JudgeScore` as JSON on its last line of stdout: each checked
 * item is a dimension, `composite` is the score, and `notes` holds one `FAIL <item> <where>:
 * <reason>` line per failed item. The record states the pass threshold. A program that does not
 * run, or prints no score, gives no verdict: it is {@link CheckUnavailableError}, and the loop
 * pauses instead of blaming the director.
 *
 * The box receives the program's files at its working directory, the submitted result at
 * `_input/result.json` when there is one, and the sealed cases at `_sealed/` only when the read
 * scores a run or a version. `CHECK_SET` is `development` or `sealed`; `CHECK_RESULT` names the
 * result file when present. Sealed cases never reach an in-run read, so their lines never reach
 * the director.
 */

import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import type { SandboxResources } from '@tangle-network/sandbox'
import { captureMaterializedWorkspace } from '../candidate-execution/artifacts'
import type { VersionJudge } from '../durable/pursuit-versions'
import { ValidationError } from '../errors'
import { type IsolatedCheckBox, type IsolatedCheckResult, runIsolatedCheck } from './isolated-checker'
import type { DeliverableSpec } from './supervise/completion-gate'
import { CheckUnavailableError, type CheckVerdict, verdictFromJudgeScore } from './supervise/continuation'

/** A check program as a record declares it. */
export interface DeclaredCheck {
  /** The evaluator program's files. A directory whose canonical digest differs is refused. */
  readonly program: { readonly dir: string; readonly digest: Sha256Digest }
  /** Executable and arguments, run in the program's directory. */
  readonly command: readonly [string, ...string[]]
  /** The box environment or image that holds the program's toolchain. */
  readonly environment: string
  /** Domains the program may reach. Absent or empty: egress is blocked. */
  readonly egress?: readonly string[]
  /** Names of this process's environment variables the program receives. A missing one refuses. */
  readonly secrets?: readonly string[]
  /** The pass threshold on the score's `composite`. */
  readonly pass: number
  /** `pass-only` keeps the FAIL lines from the director, for a check whose tests stay hidden. */
  readonly feedback: 'verbatim' | 'pass-only'
  /** Cases the director never sees. They score a run and a version, never an in-run read. */
  readonly sealed?: { readonly dir: string; readonly digest: Sha256Digest }
  /** What the run owes, for the director's tools and the note. */
  readonly describe?: string
  /** Bound on one read. Default 15 minutes. */
  readonly timeoutMs?: number
  readonly resources?: SandboxResources
}

/** Where a declared check's boxes are created: a client on the check account, and every account
 *  the judged run holds a key to, so the check refuses a box the run could reach. */
export interface DeclaredCheckPlacement {
  readonly client: IsolatedCheckBox['client']
  readonly builderAccounts: IsolatedCheckBox['builderAccounts']
  /** The environment the secrets are read from. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

const INPUT_DIR = '_input'
const SEALED_DIR = '_sealed'
const DEFAULT_TIMEOUT_MS = 15 * 60_000

/** Refuse a malformed declaration before any compute. */
export function assertDeclaredCheck(check: DeclaredCheck, context: string): void {
  const fail = (message: string): never => {
    throw new ValidationError(`${context}: check ${message}`)
  }
  if (typeof check !== 'object' || check === null) fail('must be an object')
  if (typeof check.program?.dir !== 'string' || check.program.dir.trim() === '') {
    fail('program.dir must name the evaluator directory')
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(check.program?.digest ?? '')) {
    fail('program.digest must be a sha256 digest')
  }
  if (!Array.isArray(check.command) || check.command.length === 0 || !check.command[0]) {
    fail('command must name an executable')
  }
  if (typeof check.environment !== 'string' || check.environment.trim() === '') {
    fail('environment must name the box image')
  }
  if (typeof check.pass !== 'number' || !Number.isFinite(check.pass)) {
    fail('pass must be a finite threshold on the composite')
  }
  if (check.feedback !== 'verbatim' && check.feedback !== 'pass-only') {
    fail("feedback must be 'verbatim' or 'pass-only'")
  }
  if (check.sealed !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(check.sealed.digest ?? '')) {
    fail('sealed.digest must be a sha256 digest')
  }
  for (const name of check.secrets ?? []) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) fail(`secret name ${JSON.stringify(name)} is not an env name`)
  }
}

/** The canonical digest of a directory's files: the digest a record names a program by. */
export async function checkProgramDigest(dir: string): Promise<Sha256Digest> {
  return canonicalCandidateDigest((await captureMaterializedWorkspace(dir)).manifest)
}

/** The digest a version judge records: the program, the sealed cases, and how they are run. */
export function declaredCheckDigest(check: DeclaredCheck): Sha256Digest {
  return sha256Bytes(
    Buffer.from(
      JSON.stringify({
        program: check.program.digest,
        sealed: check.sealed?.digest ?? null,
        command: check.command,
        environment: check.environment,
        pass: check.pass,
      }),
    ),
  )
}

/**
 * Read the check once. `result` is the submitted result, absent for a read of the run's state.
 * `set: 'sealed'` adds the sealed cases. Throws {@link CheckUnavailableError} when the program
 * could not run or printed no score.
 */
export async function readDeclaredCheck(
  check: DeclaredCheck,
  placement: DeclaredCheckPlacement,
  read: {
    readonly result?: unknown
    readonly set: 'development' | 'sealed'
    readonly signal?: AbortSignal
  },
): Promise<CheckVerdict> {
  if (read.set === 'sealed' && check.sealed === undefined) {
    throw new ValidationError('readDeclaredCheck: a sealed read needs check.sealed')
  }
  const environment = placement.env ?? process.env
  const secrets: Record<string, string> = {}
  for (const name of check.secrets ?? []) {
    const value = environment[name]
    if (value === undefined || value === '') {
      throw new CheckUnavailableError(`the check's secret ${name} is not set on this host`)
    }
    secrets[name] = value
  }
  const workspace = await mkdtemp(join(tmpdir(), 'declared-check-'))
  try {
    const tree = join(workspace, 'tree')
    await copyVerified(check.program.dir, check.program.digest, tree, 'program')
    const entries = await readdir(tree)
    if (entries.includes(INPUT_DIR) || entries.includes(SEALED_DIR)) {
      throw new ValidationError(
        `readDeclaredCheck: the program may not hold ${INPUT_DIR}/ or ${SEALED_DIR}/; Runtime mounts them`,
      )
    }
    const env: Record<string, string> = { ...secrets, CHECK_SET: read.set }
    if (read.result !== undefined) {
      await mkdir(join(tree, INPUT_DIR))
      await writeFile(join(tree, INPUT_DIR, 'result.json'), `${JSON.stringify(read.result)}\n`)
      env.CHECK_RESULT = `${INPUT_DIR}/result.json`
    }
    if (read.set === 'sealed' && check.sealed !== undefined) {
      await copyVerified(check.sealed.dir, check.sealed.digest, join(tree, SEALED_DIR), 'sealed cases')
    }
    const outcome = await runIsolatedCheck({
      workspaceRoot: workspace,
      tree,
      command: check.command,
      timeoutMs: check.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env,
      ...(read.signal === undefined ? {} : { signal: read.signal }),
      box: {
        client: placement.client,
        builderAccounts: placement.builderAccounts,
        environment: check.environment,
        ...(check.egress === undefined ? {} : { egress: check.egress }),
        ...(check.resources === undefined ? {} : { resources: check.resources }),
      },
    })
    return verdictOf(outcome, check.pass)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

/** The declared check as a manager's completion check: every in-run read uses development cases. */
export function declaredCheckDeliverable(
  check: DeclaredCheck,
  placement: DeclaredCheckPlacement,
): DeliverableSpec<unknown> {
  assertDeclaredCheck(check, 'declaredCheckDeliverable')
  return {
    check: (result) => readDeclaredCheck(check, placement, { result, set: 'development' }),
    checkState: () => readDeclaredCheck(check, placement, { set: 'development' }),
    feedback: check.feedback,
    ...(check.sealed === undefined ? {} : { sealed: true }),
    ...(check.describe === undefined ? {} : { describe: check.describe }),
  }
}

/**
 * The declared check as a version chain's judge: it scores a settled version on its sealed cases
 * when the record has them, and on its development cases otherwise. The per-item verdict rides in
 * the ledger, so the next version's review names each item. A read that could not run scores
 * `null`, which never counts as an improvement.
 */
export function declaredCheckJudge(
  check: DeclaredCheck,
  placement: DeclaredCheckPlacement,
): VersionJudge {
  assertDeclaredCheck(check, 'declaredCheckJudge')
  const digest = declaredCheckDigest(check)
  return {
    digest,
    async judge(version, signal) {
      try {
        const verdict = await readDeclaredCheck(check, placement, {
          ...(version.result.kind === 'winner' ? { result: version.result.out } : {}),
          set: check.sealed === undefined ? 'development' : 'sealed',
          signal,
        })
        return { score: verdict.composite ?? (verdict.pass ? 1 : 0), judgeDigest: digest, check: verdict }
      } catch (error) {
        if (!(error instanceof CheckUnavailableError)) throw error
        return { score: null, judgeDigest: digest, detail: { unavailable: error.message } }
      }
    },
  }
}

function verdictOf(outcome: IsolatedCheckResult, pass: number): CheckVerdict {
  if (!outcome.succeeded) {
    throw new CheckUnavailableError(
      `the check program ${outcome.reason}: ${outcome.diagnostic.slice(0, 2_000)}`,
    )
  }
  const lines = outcome.value.stdout.trimEnd().split('\n')
  const last = lines.at(-1) ?? ''
  let score: unknown
  try {
    score = JSON.parse(last)
  } catch {
    throw new CheckUnavailableError('the check program printed no JudgeScore on its last line')
  }
  const raw = score as { dimensions?: unknown; composite?: unknown; notes?: unknown; failed?: unknown }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.dimensions !== 'object' ||
    raw.dimensions === null ||
    typeof raw.composite !== 'number' ||
    typeof raw.notes !== 'string'
  ) {
    throw new CheckUnavailableError('the check program printed a line that is not a JudgeScore')
  }
  return verdictFromJudgeScore(
    {
      dimensions: raw.dimensions as Record<string, number>,
      composite: raw.composite,
      notes: raw.notes,
      ...(raw.failed === true ? { failed: true as const } : {}),
    },
    pass,
  )
}

async function copyVerified(
  from: string,
  digest: Sha256Digest,
  to: string,
  label: string,
): Promise<void> {
  const actual = await checkProgramDigest(from)
  if (actual !== digest) {
    throw new ValidationError(
      `readDeclaredCheck: the ${label} at ${from} is ${actual}; the record names ${digest}`,
    )
  }
  await cp(from, to, { recursive: true, dereference: false, verbatimSymlinks: true })
}
