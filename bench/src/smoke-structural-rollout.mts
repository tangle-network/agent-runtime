/**
 * smoke-structural-rollout — the ship gate for the PORTED structuralRollout strategy
 * (src/runtime/structural-rollout.ts): prove the RUNTIME code path works against a REAL
 * model on REAL HumanEval tasks. This runs `runAgentic` with the strategy over a
 * `createVerifierEnvironment` surface — routerToolLoop, the conserved pool, the metered
 * consult channel, `sandboxCheckRunner`, receipts — NOT the bench rig (hev-structural.mts).
 *
 * Honesty split (the rig's Phase A / Phase B, preserved):
 *   - The strategy sees ONLY task-visible information. The surface's check is INERT
 *     (always 0/1), so no hidden-test signal can reach selection or repair; the visible
 *     checks are the strategy's own default CheckSource (model-authored asserts, frozen
 *     before sampling), executed by the shipped `sandboxCheckRunner` over a docker
 *     `--network=none` exec channel (the thin adapter this script provides).
 *   - The task's own hidden check() suite grades every locked candidate HERE, in the
 *     script, AFTER the strategy has finished the task (`runChecker`, docker,
 *     --network=none). Nothing flows back.
 *
 * Per task we collect: the k per-sample hidden grades, the selected candidate's grade
 * (argmax over samples by the exported `selectBestIndex` — the strategy's own order),
 * the final (post-repair) grade (the receipt marked `selected`), authored-check counts,
 * and the SelectionReceipts (cross-checked against the recorded outcomes).
 *
 * Run (key via dotenvx; never in the shell history):
 *   cd ~/company/devops/secrets && dotenvx run -f agent-state.env -- bash -c ' \
 *     cd /home/drew/code/agent-runtime-swe && \
 *     HUMANEVAL_GZ=/abs/HumanEval.jsonl.gz N=20 OFFSET=0 npx tsx bench/src/smoke-structural-rollout.mts'
 */

import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import {
  type AgenticRunResult,
  type CheckExecChannel,
  type CheckOutcome,
  type CheckRunner,
  createVerifierEnvironment,
  defaultStructuralRolloutPolicy,
  runAgentic,
  type StructuralRolloutResult,
  sandboxCheckRunner,
  selectBestIndex,
  structuralRollout,
  visibleCheckScore,
} from '../../src/runtime/index'
import { basePrompt, type HumanEvalTask, loadHumanEval, runChecker } from './benchmarks/humaneval'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const N = Number(process.env.N ?? 20)
const OFFSET = Number(process.env.OFFSET ?? 0)
const MODEL = process.env.MODEL ?? 'meta-llama/Meta-Llama-3-8B-Instruct-Lite'
const BASE = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
const TEMP = Number(process.env.TEMPERATURE ?? 0.8)
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 2500)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3)
const OUT = process.env.OUT // optional JSONL of raw per-task rows

const systemPrompt = 'You are an expert Python programmer.'
const dockerImage = 'python:3.12-slim'

// ── The thin adapter: a docker --network=none exec channel for sandboxCheckRunner ────
// The runner pipes its check program as `printf '%s' '<b64>' | base64 -d | python3 -`;
// this channel runs that command inside a jailed container. Infra faults (no docker,
// daemon down) fail loud; a candidate crash/hang is a real outcome (non-zero exit / no
// sentinel), returned, never thrown. Modeled on bench/src/benchmarks/humaneval.ts.
let containerSeq = 0
function dockerExecChannel(): CheckExecChannel {
  return {
    exec(command, options) {
      const timeoutMs = options?.timeoutMs ?? 20000
      const name = `srck-${process.pid}-${containerSeq++}`
      return new Promise((resolve, reject) => {
        let settled = false
        const reap = () => execFile('docker', ['rm', '-f', name], () => {})
        const finish = (r: { exitCode: number; stdout: string; stderr: string }) => {
          if (settled) return
          settled = true
          clearTimeout(backstop)
          reap()
          resolve(r)
        }
        const fail = (e: Error) => {
          if (settled) return
          settled = true
          clearTimeout(backstop)
          reap()
          reject(e)
        }
        // execFile's timeout kills the docker CLIENT; a hung container could leave the
        // callback unfired. The backstop guarantees resolution (no sentinel ⇒ the runner
        // scores it crashed) and the named reap kills the stray container.
        const backstop = setTimeout(
          () => finish({ exitCode: 124, stdout: '', stderr: 'timed out (backstop)' }),
          timeoutMs + 3000,
        )
        execFile(
          'docker',
          ['run', '--rm', '--name', name, '--network=none', '--cpus=1', '--memory=512m', dockerImage, 'sh', '-c', command],
          { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) {
              const e = err as NodeJS.ErrnoException & { code?: number | string }
              if (e.code === 'ENOENT') {
                fail(new Error('docker binary not found on PATH — cannot run visible checks'))
                return
              }
              if (/cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect/i.test(stderr ?? '')) {
                fail(new Error(`docker daemon unreachable: ${(stderr ?? '').slice(0, 200)}`))
                return
              }
              const exitCode = typeof e.code === 'number' ? e.code : 1
              finish({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' })
              return
            }
            finish({ exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
          },
        )
      })
    },
  }
}

// ── Recording wrapper: capture each (candidate, outcome) the strategy scores, in order.
// Delegates verbatim to the shipped runner — the code under test stays the strategy.
interface ScoredCandidate {
  candidate: string
  outcome: CheckOutcome
}
function recordingRunner(inner: CheckRunner, log: ScoredCandidate[]): CheckRunner {
  return {
    async run(candidate, checks, ctx) {
      const outcome = await inner.run(candidate, checks, ctx)
      log.push({ candidate, outcome })
      return outcome
    },
  }
}

interface TaskRow {
  taskId: string
  error?: string
  officialChecks: number
  authoredChecks: number
  repairStop: string
  shots: number
  sampleHidden: number[]
  blindMean: number
  selectedIdx: number
  selectedHidden: number
  finalIdx: number
  finalHidden: number
  selectedVisible: number
  receipts: Array<{ candidateIndex: number; selected: boolean; score: number; reason: string }>
  tokens: { input: number; output: number }
  usd: number
  ms: number
}

async function runTask(t: HumanEvalTask): Promise<TaskRow> {
  const scored: ScoredCandidate[] = []
  const policy = { ...defaultStructuralRolloutPolicy, temperature: TEMP }
  const strategy = structuralRollout({
    policy,
    checkRunner: recordingRunner(sandboxCheckRunner({ box: dockerExecChannel() }), scored),
  })
  // INERT check: the strategy's harness-verified score channel must carry no hidden
  // signal — hidden grading is this script's job, after the rollout locks its artifacts.
  const surface = createVerifierEnvironment({
    name: 'humaneval-inert',
    check: () => ({ passes: 0, total: 1, errored: 0 }),
  })
  const result = (await runAgentic({
    surface,
    task: {
      id: t.taskId,
      systemPrompt,
      userPrompt: basePrompt(t),
      meta: { entryPoint: t.entryPoint },
    },
    routerBaseUrl: BASE,
    routerKey: must('TOGETHER_API_KEY'),
    model: MODEL,
    temperature: TEMP,
    maxTokens: MAX_TOKENS,
    innerTurns: 2,
    strategy,
    // The strategy's documented sizing: k samples + repair rounds + the check-author consult.
    budget: policy.k + policy.repairRounds + 1,
  })) as AgenticRunResult & StructuralRolloutResult

  // Receipts ↔ recorded outcomes must agree exactly (candidateIndex is the recording
  // order: samples first, then repairs). A mismatch is an adapter or strategy defect.
  if (result.selection.length !== scored.length) {
    throw new Error(
      `${t.taskId}: ${result.selection.length} receipts vs ${scored.length} scored candidates`,
    )
  }
  const receipts = result.selection.map((receipt) => {
    if (receipt.score === undefined || receipt.reason === undefined) {
      throw new Error(`${t.taskId}: receipt #${receipt.candidateIndex} is missing score or reason`)
    }
    return {
      candidateIndex: receipt.candidateIndex,
      selected: receipt.selected,
      score: receipt.score,
      reason: receipt.reason,
    }
  })
  for (const r of receipts) {
    const rec = scored[r.candidateIndex]
    if (!rec || Math.abs(r.score - visibleCheckScore(rec.outcome)) > 1e-9) {
      throw new Error(`${t.taskId}: receipt #${r.candidateIndex} score ${r.score} does not match the recorded outcome`)
    }
  }

  const sampleCount = receipts.filter((r) => r.reason.startsWith('sample')).length
  const samples = scored.slice(0, sampleCount)
  if (samples.length === 0) throw new Error(`${t.taskId}: no sample candidates settled`)

  // Hidden grading (script-side, docker --network=none): every distinct candidate once.
  const gradeCache = new Map<string, Promise<number>>()
  const grade = (candidate: string): Promise<number> => {
    let p = gradeCache.get(candidate)
    if (!p) {
      p = runChecker(t, candidate).then((r) => r.pass)
      gradeCache.set(candidate, p)
    }
    return p
  }
  const sampleHidden = await Promise.all(samples.map((s) => grade(s.candidate)))
  const selectedIdx = selectBestIndex(samples.map((s) => s.outcome))
  const selectedHidden = sampleHidden[selectedIdx] as number
  const winner = receipts.find((r) => r.selected)
  if (!winner) throw new Error(`${t.taskId}: no receipt marked selected`)
  const finalIdx = winner.candidateIndex
  const finalHidden = await grade((scored[finalIdx] as ScoredCandidate).candidate)

  return {
    taskId: t.taskId,
    officialChecks: result.officialChecks,
    authoredChecks: result.authoredChecks,
    repairStop: result.repairStop,
    shots: result.shots,
    sampleHidden,
    blindMean: sampleHidden.reduce((a, b) => a + b, 0) / sampleHidden.length,
    selectedIdx,
    selectedHidden,
    finalIdx,
    finalHidden,
    selectedVisible: visibleCheckScore((samples[selectedIdx] as ScoredCandidate).outcome),
    receipts,
    tokens: result.tokens,
    usd: result.usd,
    ms: result.ms,
  }
}

async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      out[i] = await fn(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

let unhandled = 0
process.on('unhandledRejection', (e) => {
  unhandled += 1
  console.error('UNHANDLED REJECTION:', e)
})

const pct = (x: number) => `${(100 * x).toFixed(1)}%`

async function main(): Promise<void> {
  must('TOGETHER_API_KEY')
  const tasks = await loadHumanEval(N, OFFSET)
  const { k, repairRounds, testgen } = defaultStructuralRolloutPolicy
  console.log(
    `=== structuralRollout RUNTIME smoke · n=${tasks.length} offset=${OFFSET} · k=${k} repairs<=${repairRounds} testgen=${testgen} temp=${TEMP} ===`,
  )
  console.log(`  model=${MODEL}  base=${BASE}  maxTokens=${MAX_TOKENS}  task-concurrency=${CONCURRENCY}`)
  console.log(`  path: runAgentic → structuralRollout(default policy) → createVerifierEnvironment(inert) → sandboxCheckRunner(docker --network=none)`)

  const started = Date.now()
  const rows = await pooled(tasks, CONCURRENCY, async (t): Promise<TaskRow> => {
    try {
      const row = await runTask(t)
      const hid = row.sampleHidden.join(' ')
      console.log(
        `  ${t.taskId.padEnd(14)} auth=${row.authoredChecks}  samples=[${hid}]  sel=#${row.selectedIdx}:${row.selectedHidden ? 'PASS' : 'fail'}  final=#${row.finalIdx}:${row.finalHidden ? 'PASS' : 'fail'}  ${row.repairStop}`,
      )
      if (OUT) appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      return row
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ${t.taskId.padEnd(14)} ERROR: ${msg}`)
      if (OUT) appendFileSync(OUT, `${JSON.stringify({ taskId: t.taskId, error: msg })}\n`)
      return {
        taskId: t.taskId,
        error: msg,
        officialChecks: 0,
        authoredChecks: 0,
        repairStop: 'error',
        shots: 0,
        sampleHidden: [],
        blindMean: 0,
        selectedIdx: -1,
        selectedHidden: 0,
        finalIdx: -1,
        finalHidden: 0,
        selectedVisible: 0,
        receipts: [],
        tokens: { input: 0, output: 0 },
        usd: 0,
        ms: 0,
      }
    }
  })

  const ok = rows.filter((r) => !r.error)
  const errored = rows.filter((r) => r.error)

  console.log('\n── per-task ──')
  console.log(
    'task            auth  samples(hidden)  blind%   sel      final    visSel  repairStop        shots  tok(in/out)     ms',
  )
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.taskId.padEnd(15)} ERROR ${r.error.slice(0, 90)}`)
      continue
    }
    console.log(
      [
        r.taskId.padEnd(15),
        String(r.authoredChecks).padEnd(5),
        r.sampleHidden.join(' ').padEnd(16),
        pct(r.blindMean).padEnd(8),
        `#${r.selectedIdx}:${r.selectedHidden ? 'PASS' : 'fail'}`.padEnd(8),
        `#${r.finalIdx}:${r.finalHidden ? 'PASS' : 'fail'}`.padEnd(8),
        r.selectedVisible.toFixed(3).padEnd(7),
        r.repairStop.padEnd(17),
        String(r.shots).padEnd(6),
        `${r.tokens.input}/${r.tokens.output}`.padEnd(15),
        String(r.ms),
      ].join(' '),
    )
  }

  const blind = ok.reduce((a, r) => a + r.blindMean, 0) / Math.max(1, ok.length)
  const selected = ok.reduce((a, r) => a + r.selectedHidden, 0) / Math.max(1, ok.length)
  const final = ok.reduce((a, r) => a + r.finalHidden, 0) / Math.max(1, ok.length)
  const sample0 = ok.reduce((a, r) => a + (r.sampleHidden[0] ?? 0), 0) / Math.max(1, ok.length)
  const oracleAtK = ok.reduce((a, r) => a + (r.sampleHidden.some((x) => x === 1) ? 1 : 0), 0) / Math.max(1, ok.length)
  const tokens = ok.reduce((a, r) => ({ input: a.input + r.tokens.input, output: a.output + r.tokens.output }), { input: 0, output: 0 })

  console.log('\n── summary ──')
  console.log(`tasks: ${ok.length} scored, ${errored.length} errored (of ${rows.length})`)
  console.log(`blind mean-of-k : ${pct(blind)}   (sample-0 only: ${pct(sample0)}; oracle@k ceiling: ${pct(oracleAtK)})`)
  console.log(`selected@1      : ${pct(selected)}   (lift over blind: ${(100 * (selected - blind)).toFixed(1)}pp)`)
  console.log(`final (repaired): ${pct(final)}   (lift over blind: ${(100 * (final - blind)).toFixed(1)}pp)`)
  console.log(`spend: tokens ${tokens.input} in / ${tokens.output} out · wall ${((Date.now() - started) / 1000).toFixed(0)}s`)

  // ── Acceptance (mechanism, not significance — n is small) ──
  const authoredTasks = ok.filter((r) => r.authoredChecks > 0).length
  const receiptsSane = ok.every((r) => r.receipts.length > 0 && r.receipts.length === r.shots)
  const ordering = final >= selected && selected >= blind
  const liftPp = 100 * (final - blind)
  const rescued = ok.filter((r) => r.finalHidden === 1 && (r.sampleHidden[0] ?? 0) === 0)
  const checks: Array<[string, boolean, string]> = [
    ['authored checks on >=17/20 tasks', authoredTasks >= 17, `${authoredTasks}/${rows.length} tasks`],
    ['selection receipts present, scores match recorded outcomes', receiptsSane && ok.length > 0, `verified on ${ok.length} tasks (hard-checked per receipt)`],
    ['final >= selected >= blind and final-blind >= +5pp', ordering && liftPp >= 5, `blind ${pct(blind)} → selected ${pct(selected)} → final ${pct(final)} (+${liftPp.toFixed(1)}pp)`],
    ['>=1 task rescued (final passes, sample 0 fails)', rescued.length >= 1, rescued.map((r) => r.taskId).join(', ') || 'none'],
    ['zero crashes / unhandled rejections', errored.length === 0 && unhandled === 0, `${errored.length} task errors, ${unhandled} unhandled rejections`],
  ]
  console.log('\n── acceptance ──')
  let allPass = true
  for (const [label, pass, detail] of checks) {
    if (!pass) allPass = false
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label} — ${detail}`)
  }
  console.log(allPass ? '\nSMOKE: PASS' : '\nSMOKE: FAIL')
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
