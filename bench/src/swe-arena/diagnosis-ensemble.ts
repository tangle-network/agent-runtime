/**
 * Diagnosis ensemble — N BLIND failure analysts over the SAME supervisor-run
 * artifacts (brain.jsonl, driver.log, workers/*.ndjson + *.patch, verify.log,
 * result.json, the delivered patch, and the official-judge outcome), each a
 * different model routed through router.tangle.tools, fused by union +
 * cross-analyst agreement ranking. Minority findings SURVIVE fusion marked as
 * competing hypotheses — the round-4 protocol treats them as candidate
 * proposal seeds, not noise.
 *
 * Design constraints (from supervisor-lab .evolve/state.json round4_design):
 *  - the model list is CONFIG — glm-5.2 is the only model proven routed today;
 *    gpt-5.5 / opus-4.8 slot in by editing the analyst spec list, never by a
 *    hardcoded requirement on an unrouted model.
 *  - analysts are blind: same bundle, no cross-talk, independent calls.
 *  - secrets discipline matches capacity.ts: the API key is referenced by NAME
 *    inside a dotenvx child shell; the response body lands in a file (dotenvx
 *    writes its banner to stdout, so stdout is only trusted for the marker).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type AnalystFinding, makeFinding } from '@tangle-network/agent-eval'
import { findSupervisorRunDir, type SecretsEnv } from './arms'
import { ROUTER_ENDPOINT } from './capacity'
import { run } from './proc'

// ---------------------------------------------------------------------------
// Analyst specs.
// ---------------------------------------------------------------------------

export interface AnalystSpec {
  /** Stable label, e.g. 'glm-5.2#1'. Used in fusion attribution + filenames. */
  id: string
  model: string
  /** Chat-completions endpoint. Default: the Tangle router. */
  url?: string
  /** NAME of the env var holding the bearer key (resolved in the dotenvx child). */
  apiKeyEnv?: string
  /** glm-5.2 returns empty content when starved below ~8000, and at sampled
   *  temperatures its REASONING alone can consume a full 8000 ceiling (both
   *  measured — the calibration smoke saw out=8000 with empty content).
   *  Default 16_000 so reasoning + the JSON answer always fit. */
  maxTokens?: number
  temperature?: number
}

/** N same-model analysts (the smoke default). Real rounds replace entries with
 *  other routed models — diversity comes from the config, never a hardcode.
 *  Same-model analysts at temperature 0 are byte-identical duplicates (measured
 *  in the calibration smoke: #2 and #3 returned the same 2823 output tokens),
 *  which silently inflates agreement — so only the FIRST same-model analyst
 *  runs at 0; the rest sample at 0.7 to buy real diversity. */
export function defaultAnalysts(n = 3, model = 'glm-5.2'): AnalystSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${model}#${i + 1}`,
    model,
    temperature: i === 0 ? 0 : 0.7,
  }))
}

// ---------------------------------------------------------------------------
// Artifact bundle — the ONE shared context every blind analyst reads.
// ---------------------------------------------------------------------------

/** One supervisor arm run to diagnose. `dir` is the run dir layout the arms
 *  write: brain.jsonl / driver.log / result.json / verify.log / ws/. */
export interface SupRunArtifacts {
  iid: string
  arm: string
  dir: string
  /** The delivered (extracted) arm patch, when it exists. */
  patchPath?: string
  /** Official-judge outcome for this run, when known. `resolved: null` =
   *  inconclusive judge — shown to analysts as such, never coerced. */
  judge?: { resolved: boolean | null; score?: number; note?: string }
}

export interface BundleOptions {
  /** Total bundle ceiling (chars). Default 60_000 (~15-20k tokens). */
  maxChars?: number
  /** Max workers whose ndjson/patch are excerpted per run. Default 6. */
  maxWorkers?: number
}

const head = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}\n…[truncated head]`)
const tail = (s: string, n: number): string => (s.length <= n ? s : `…[truncated tail]\n${s.slice(-n)}`)

async function safeRead(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '')
}

function section(title: string, body: string): string {
  const trimmed = body.trim()
  if (trimmed.length === 0) return ''
  return `--- ${title} ---\n${trimmed}\n`
}

const runSeparator = '\n\n'
const runEvidenceTruncationMarker = '\n…[RUN EVIDENCE TRUNCATED]…\n'

function boundRunEvidence(evidence: string, maxChars: number): string {
  if (evidence.length <= maxChars) return evidence
  if (maxChars <= 0) return ''
  if (maxChars <= runEvidenceTruncationMarker.length) return evidence.slice(-maxChars)
  const retainedChars = maxChars - runEvidenceTruncationMarker.length
  const headChars = Math.floor(retainedChars / 2)
  const tailChars = retainedChars - headChars
  return `${evidence.slice(0, headChars)}${runEvidenceTruncationMarker}${evidence.slice(-tailChars)}`
}

/** Build the bounded shared bundle. Every section is capped so one megabyte
 *  brain log cannot crowd out the patch the analysts must actually read. When
 *  the total cap binds, every run gets an equal share before concatenation;
 *  its identity, judge, and result stay intact while evidence keeps bounded
 *  head and tail excerpts (the delivered patch is ordered last). */
export async function buildArtifactBundle(
  runs: SupRunArtifacts[],
  opts: BundleOptions = {},
): Promise<string> {
  const maxChars = opts.maxChars ?? 60_000
  const maxWorkers = opts.maxWorkers ?? 6
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new Error(`artifact bundle maxChars must be a positive safe integer, got ${maxChars}`)
  }
  const runParts: Array<{ core: string; evidence: string; full: string }> = []
  for (const r of runs) {
    const coreChunks: string[] = [`### RUN ${r.iid} arm=${r.arm}\nrun dir: ${r.dir}`]
    if (r.judge) {
      coreChunks.push(
        `official judge: resolved=${r.judge.resolved === null ? 'INCONCLUSIVE' : r.judge.resolved}` +
          (r.judge.score !== undefined ? ` score=${r.judge.score}` : '') +
          (r.judge.note ? ` (${r.judge.note})` : ''),
      )
    }
    coreChunks.push(section('result.json', head(await safeRead(join(r.dir, 'result.json')), 1_500)))
    const evidenceChunks: string[] = []
    evidenceChunks.push(section('verify.log (tail)', tail(await safeRead(join(r.dir, 'verify.log')), 2_000)))
    const driver = await safeRead(join(r.dir, 'driver.log'))
    evidenceChunks.push(section('driver.log (head)', head(driver, 800)))
    evidenceChunks.push(section('driver.log (tail)', tail(driver, 4_000)))
    evidenceChunks.push(section('brain.jsonl (tail)', tail(await safeRead(join(r.dir, 'brain.jsonl')), 4_000)))

    const supRunDir = await findSupervisorRunDir(join(r.dir, 'ws'))
    if (supRunDir) {
      evidenceChunks.push(section('supervisor state.json', head(await safeRead(join(supRunDir, 'state.json')), 3_500)))
      evidenceChunks.push(section('supervisor journal.jsonl (tail)', tail(await safeRead(join(supRunDir, 'journal.jsonl')), 3_000)))
      const workerFiles = (await readdir(join(supRunDir, 'workers')).catch(() => [] as string[])).sort()
      const ndjson = workerFiles.filter((f) => f.endsWith('.ndjson')).slice(0, maxWorkers)
      const patches = workerFiles.filter((f) => f.endsWith('.patch')).slice(0, maxWorkers)
      for (const f of ndjson) {
        evidenceChunks.push(section(`workers/${f} (tail)`, tail(await safeRead(join(supRunDir, 'workers', f)), 2_500)))
      }
      for (const f of patches) {
        evidenceChunks.push(section(`workers/${f} (head)`, head(await safeRead(join(supRunDir, 'workers', f)), 3_000)))
      }
    }
    if (r.patchPath) {
      evidenceChunks.push(section('DELIVERED PATCH (head)', head(await safeRead(r.patchPath), 6_000)))
    }
    const core = coreChunks.filter(Boolean).join('\n')
    const evidence = evidenceChunks.filter(Boolean).join('\n')
    runParts.push({ core, evidence, full: [core, evidence].filter(Boolean).join('\n') })
  }
  const bundle = runParts.map((part) => part.full).join(runSeparator)
  if (bundle.length <= maxChars) return bundle
  const separatorChars = runSeparator.length * Math.max(0, runParts.length - 1)
  const availableChars = maxChars - separatorChars
  const baseRunBudget = Math.floor(availableChars / runParts.length)
  const remainder = availableChars % runParts.length
  const boundedRuns = runParts.map((part, index) => {
    const runBudget = baseRunBudget + (index < remainder ? 1 : 0)
    if (part.core.length > runBudget) {
      throw new Error(
        `artifact bundle maxChars=${maxChars} cannot preserve run identity/judge/result for all ${runParts.length} runs; ` +
          `run ${runs[index]!.iid} needs ${part.core.length} chars but its fair share is ${runBudget}`,
      )
    }
    const evidence = part.evidence.length > 0 ? `\n${part.evidence}` : ''
    return `${part.core}${boundRunEvidence(evidence, runBudget - part.core.length)}`
  })
  return boundedRuns.join(runSeparator)
}

// ---------------------------------------------------------------------------
// One blind analyst call.
// ---------------------------------------------------------------------------

export interface AnalystRawFinding {
  failure_class: string
  evidence_quote: string
  proposed_direction: string
  /** 0..1, clamped. Defaults to 0.5 when the model omits it. */
  confidence: number
}

export interface AnalystReport {
  analystId: string
  model: string
  ok: boolean
  findings: AnalystRawFinding[]
  error?: string
  /** Raw model text, kept for the audit trail. */
  rawText?: string
  tokens?: { input: number; output: number }
}

/** The blind-analyst instruction. Exported so the calibration smoke and tests
 *  pin the exact contract the parser expects. */
export function analystPrompt(bundle: string): string {
  return [
    'You are one independent, BLIND failure analyst (other analysts see the same artifacts; you cannot see them).',
    'The artifacts below come from runs of an automated software-engineering SUPERVISOR agent on SWE-bench Verified instances:',
    '- a supervisor "brain" plans, spawns sandboxed workers (each in a clone of the instance repo), and settles a delivered patch;',
    '- each run has a self-authored verify script (worker-visible reproduction check);',
    '- after the run locks, the OFFICIAL hidden maintainer test suite grades the delivered patch (worker-blind);',
    '- "verify_pass=true but official resolved=false" means the self-check passed while the maintainers\' tests did not.',
    '',
    'Diagnose the DOMINANT reasons these runs failed to resolve. Ground every finding in a verbatim quote from the artifacts.',
    'Respond with STRICT JSON only (no markdown fences, no commentary):',
    '{"findings":[{"failure_class":"2-6 word category","evidence_quote":"verbatim from artifacts","proposed_direction":"concrete change direction","confidence":0.0}]}',
    'Return 1 to 5 findings, most important first.',
    '',
    '===== ARTIFACTS =====',
    bundle,
  ].join('\n')
}

/** Extract + validate the strict-JSON findings contract from model text.
 *  Tolerates code fences and leading/trailing prose; throws on anything that
 *  does not contain one parseable findings object (the caller records the
 *  analyst as failed — never a silently-empty diagnosis). */
export function parseAnalystFindings(text: string): AnalystRawFinding[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const start = stripped.indexOf('{')
  if (start === -1) throw new Error('analyst output contains no JSON object')
  // Balanced-brace scan from the first '{' — models love trailing prose.
  let depth = 0
  let end = -1
  let inString = false
  let escaped = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('analyst output JSON object never closes')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1))
  } catch (cause) {
    throw new Error(`analyst output is not valid JSON: ${(cause as Error).message}`)
  }
  const findings = (parsed as { findings?: unknown }).findings
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new Error('analyst output has no findings array')
  }
  return findings.map((f, i) => {
    const o = f as Record<string, unknown>
    const failureClass = typeof o.failure_class === 'string' ? o.failure_class.trim() : ''
    if (!failureClass) throw new Error(`finding ${i} missing failure_class`)
    const conf = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0.5
    return {
      failure_class: failureClass,
      evidence_quote: typeof o.evidence_quote === 'string' ? o.evidence_quote : '',
      proposed_direction: typeof o.proposed_direction === 'string' ? o.proposed_direction : '',
      confidence: Math.min(1, Math.max(0, conf)),
    }
  })
}

/** POST one blind analyst call through the router via dotenvx (key stays in
 *  the child; response body lands in `outFile`, never on shared stdout).
 *  ONE retry on transport failure (5xx/524/timeout) — an edge flake was
 *  observed live in the calibration smoke; a parse failure is NOT retried
 *  (same prompt, same model ⇒ same bad shape). */
export async function runAnalyst(
  spec: AnalystSpec,
  bundle: string,
  secrets: SecretsEnv,
  scratchDir: string,
  opts: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {},
): Promise<AnalystReport> {
  const apiKeyEnv = spec.apiKeyEnv ?? 'TANGLE_API_KEY'
  if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
    return { analystId: spec.id, model: spec.model, ok: false, findings: [], error: `invalid apiKeyEnv name: ${apiKeyEnv}` }
  }
  const url = spec.url ?? ROUTER_ENDPOINT
  const body = JSON.stringify({
    model: spec.model,
    messages: [{ role: 'user', content: analystPrompt(bundle) }],
    temperature: spec.temperature ?? 0,
    max_tokens: spec.maxTokens ?? 16_000,
  })
  await mkdir(scratchDir, { recursive: true })
  const outFile = join(scratchDir, `analyst-${spec.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.response.json`)
  const timeoutMs = opts.timeoutMs ?? 600_000
  // Body via stdin (--data @-) so the payload never sits on a command line;
  // the HTTP code is marker-anchored on stdout (dotenvx banners share stdout).
  const script =
    `curl -sS -o "$DIAG_OUT" -w "HTTP_CODE=%{http_code}" --max-time ${Math.ceil(timeoutMs / 1000) - 20} ` +
    `-X POST "$DIAG_URL" -H "Authorization: Bearer $${apiKeyEnv}" -H "Content-Type: application/json" --data @-`
  const argv = ['run', ...secrets.envFiles.flatMap((f) => ['-f', f]), '--', 'bash', '-c', script]
  const attempts = 1 + (opts.retries ?? 1)
  let transportError = ''
  let transported = false
  for (let attempt = 0; attempt < attempts && !transported; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 5_000))
    const res = await run('dotenvx', argv, {
      cwd: secrets.secretsDir,
      timeoutMs,
      stdin: body,
      env: { ...process.env, DIAG_URL: url, DIAG_OUT: outFile },
    })
    const codeMatch = res.stdout.match(/HTTP_CODE=(\d{3})\s*$/)
    if (codeMatch && codeMatch[1] === '200') {
      transported = true
    } else {
      transportError = `router call failed (http=${codeMatch?.[1] ?? 'none'}, rc=${res.code}${res.timedOut ? ', timeout' : ''}, attempt=${attempt + 1}/${attempts})`
    }
  }
  if (!transported) {
    return { analystId: spec.id, model: spec.model, ok: false, findings: [], error: transportError }
  }
  let content = ''
  let tokens: AnalystReport['tokens']
  try {
    const parsed = JSON.parse(await readFile(outFile, 'utf8')) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    content = parsed.choices?.[0]?.message?.content ?? ''
    if (parsed.usage) {
      tokens = { input: parsed.usage.prompt_tokens ?? 0, output: parsed.usage.completion_tokens ?? 0 }
    }
  } catch (cause) {
    return { analystId: spec.id, model: spec.model, ok: false, findings: [], error: `unparseable response body: ${(cause as Error).message}` }
  }
  if (content.trim().length === 0) {
    return { analystId: spec.id, model: spec.model, ok: false, findings: [], error: 'empty content (max_tokens starvation?)', tokens }
  }
  try {
    const findings = parseAnalystFindings(content)
    return { analystId: spec.id, model: spec.model, ok: true, findings, rawText: content, tokens }
  } catch (cause) {
    return { analystId: spec.id, model: spec.model, ok: false, findings: [], error: (cause as Error).message, rawText: content, tokens }
  }
}

// ---------------------------------------------------------------------------
// Fusion — union + agreement rank; minority findings survive flagged.
// ---------------------------------------------------------------------------

export interface FusedFinding {
  /** Representative label (the first-seen member's failure_class). */
  failure_class: string
  /** Distinct analysts whose findings landed in this cluster. */
  analysts: string[]
  agreement: number
  /** True when only ONE analyst surfaced it while others reported ok — a
   *  surviving minority view, kept as an explicit competing hypothesis. */
  competingHypothesis: boolean
  meanConfidence: number
  evidence: Array<{ analyst: string; quote: string }>
  directions: Array<{ analyst: string; direction: string }>
}

const CLASS_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'or', 'is', 'for', 'with', 'by', 'at', 'not', 'no',
])

/** Normalized token set of a failure-class label. */
export function classTokens(label: string): string[] {
  return [
    ...new Set(
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1 && !CLASS_STOPWORDS.has(t)),
    ),
  ].sort()
}

/** Jaccard similarity of two class labels' token sets. */
export function classSimilarity(a: string, b: string): number {
  const ta = classTokens(a)
  const tb = new Set(classTokens(b))
  if (ta.length === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter += 1
  return inter / (ta.length + tb.size - inter)
}

/**
 * Fuse per-analyst findings: greedy clustering on failure-class similarity
 * (>= threshold joins the first matching cluster), then rank by agreement
 * (desc) and mean confidence (desc). Every input finding survives — union, not
 * intersection; a single-analyst cluster is marked `competingHypothesis` when
 * at least one OTHER analyst produced a successful report.
 */
export function fuseFindings(
  reports: AnalystReport[],
  opts: { similarityThreshold?: number } = {},
): FusedFinding[] {
  const threshold = opts.similarityThreshold ?? 0.5
  const okReports = reports.filter((r) => r.ok)
  interface Cluster {
    representative: string
    members: Array<{ analyst: string; finding: AnalystRawFinding }>
  }
  const clusters: Cluster[] = []
  for (const report of okReports) {
    for (const finding of report.findings) {
      const match = clusters.find((c) => classSimilarity(c.representative, finding.failure_class) >= threshold)
      if (match) {
        match.members.push({ analyst: report.analystId, finding })
      } else {
        clusters.push({ representative: finding.failure_class, members: [{ analyst: report.analystId, finding }] })
      }
    }
  }
  const fused = clusters.map((c): FusedFinding => {
    const analysts = [...new Set(c.members.map((m) => m.analyst))]
    return {
      failure_class: c.representative,
      analysts,
      agreement: analysts.length,
      competingHypothesis: analysts.length === 1 && okReports.length > 1,
      meanConfidence:
        c.members.reduce((s, m) => s + m.finding.confidence, 0) / c.members.length,
      evidence: c.members
        .filter((m) => m.finding.evidence_quote.length > 0)
        .map((m) => ({ analyst: m.analyst, quote: m.finding.evidence_quote })),
      directions: c.members
        .filter((m) => m.finding.proposed_direction.length > 0)
        .map((m) => ({ analyst: m.analyst, direction: m.finding.proposed_direction })),
    }
  })
  return fused.sort((a, b) => b.agreement - a.agreement || b.meanConfidence - a.meanConfidence)
}

// ---------------------------------------------------------------------------
// The ensemble.
// ---------------------------------------------------------------------------

export interface DiagnosisEnsembleResult {
  bundleChars: number
  reports: AnalystReport[]
  fused: FusedFinding[]
}

/** Run every analyst (sequentially — gentle on the shared router key) over the
 *  SAME bundle and fuse. A failed analyst is recorded, never fabricated. */
export async function runDiagnosisEnsemble(input: {
  analysts: AnalystSpec[]
  runs: SupRunArtifacts[]
  secrets: SecretsEnv
  scratchDir: string
  maxBundleChars?: number
  timeoutMsPerAnalyst?: number
  /** Transport retries per analyst (router 524 storms are a measured, known
   *  infra class — the loops brain itself runs with LOOPS_BRAIN_RETRIES=30). */
  retriesPerAnalyst?: number
  retryDelayMs?: number
  onStatus?: (msg: string) => void
}): Promise<DiagnosisEnsembleResult> {
  if (input.analysts.length === 0) throw new Error('diagnosis ensemble: no analysts configured')
  if (input.runs.length === 0) throw new Error('diagnosis ensemble: no run artifacts to diagnose')
  const bundle = await buildArtifactBundle(
    input.runs,
    input.maxBundleChars !== undefined ? { maxChars: input.maxBundleChars } : {},
  )
  await mkdir(input.scratchDir, { recursive: true })
  await writeFile(join(input.scratchDir, 'bundle.txt'), bundle)
  const reports: AnalystReport[] = []
  for (const spec of input.analysts) {
    input.onStatus?.(`analyst ${spec.id} (${spec.model}) reading ${bundle.length} chars…`)
    const report = await runAnalyst(spec, bundle, input.secrets, input.scratchDir, {
      ...(input.timeoutMsPerAnalyst !== undefined ? { timeoutMs: input.timeoutMsPerAnalyst } : {}),
      ...(input.retriesPerAnalyst !== undefined ? { retries: input.retriesPerAnalyst } : {}),
      ...(input.retryDelayMs !== undefined ? { retryDelayMs: input.retryDelayMs } : {}),
    })
    input.onStatus?.(
      `analyst ${spec.id}: ${report.ok ? `${report.findings.length} finding(s)` : `FAILED (${report.error})`}` +
        (report.tokens ? ` [tokens in=${report.tokens.input} out=${report.tokens.output}]` : ''),
    )
    reports.push(report)
  }
  return { bundleChars: bundle.length, reports, fused: fuseFindings(reports) }
}

/** Calibration grading: does a finding surface FIX PLACEMENT (the known truth
 *  of the round-2 django run — a locally-authored helper where the gold fix
 *  extends django/utils/encoding.py)? Assistive keyword net; the smoke always
 *  prints the raw findings so a miss here is auditable, never load-bearing. */
export function surfacesPlacementRegex(): RegExp {
  return /placement|misplac|wrong\s+(file|location|module|place)|different\s+(file|location|module)|expected\s+(location|file|module)|local\s+(helper|copy|implementation)|duplicat|encoding\.py|django\.utils\.encoding|utils\/encoding|belongs\s+in|should\s+(live|be\s+placed|be\s+located|go)\s+in|reimplement|instead\s+of\s+(the\s+)?(existing|shared|upstream)/i
}

/** Map fused findings onto the substrate's `AnalystFinding` envelope so they
 *  drop into the same `analyzeGeneration` slot the raw-trace distiller uses. */
export function fusedToAnalystFindings(
  fused: FusedFinding[],
  evidence: { dirs: string[]; totalAnalysts: number },
): AnalystFinding[] {
  return fused.map((f) => {
    const directions = f.directions.map((d) => `[${d.analyst}] ${d.direction}`).join(' | ')
    const quotes = f.evidence
      .slice(0, 3)
      .map((e) => `[${e.analyst}] "${e.quote.slice(0, 240)}"`)
      .join('; ')
    return makeFinding({
      analyst_id: 'diagnosis-ensemble',
      severity: f.agreement >= 2 ? 'high' : 'medium',
      area: 'failure-diagnosis',
      confidence: Math.min(1, Math.max(0, f.meanConfidence)),
      claim:
        `${f.competingHypothesis ? '[competing hypothesis] ' : ''}` +
        `(${f.agreement}/${evidence.totalAnalysts} analysts) ${f.failure_class}` +
        (quotes ? ` — evidence: ${quotes}` : ''),
      ...(directions ? { recommended_action: directions } : {}),
      evidence_refs: evidence.dirs.map((d) => ({ kind: 'artifact' as const, uri: d })),
      metadata: {
        agreement: f.agreement,
        competingHypothesis: f.competingHypothesis,
        analysts: f.analysts,
      },
    })
  })
}
