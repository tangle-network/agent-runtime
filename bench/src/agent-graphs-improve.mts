/**
 * codemode-skill improvement harness — the BASELINE half of skills/agent-graphs/IMPROVE.md.
 *
 * The improving artifact is the skill TEXT (`skills/agent-graphs/SKILL.md`), a `MutableSurface`
 * string. This file owns exactly the two slots the agent-eval machinery leaves to the caller:
 *
 *   • closure A (`dispatchWithSurface`-compatible): author an agent graph from a loose case
 *     brief, carrying the full skill text; if the author decides "graph", LOWER it to a real
 *     `AgentGraph` and execute it OFFLINE via `runGraph` (scripted brain + stub leaf seam, the
 *     `examples/graphs/` pattern) — a validation refusal is captured as data, never papered over.
 *   • closure B (`JudgeConfig`-compatible deterministic scorer): map each case's `expect` block
 *     to mechanical checks over the authored artifact + the offline edge ledger; partial credit
 *     per satisfied expectation, equal weights.
 *
 * Baseline run:  pnpm tsx src/agent-graphs-improve.mts        (from bench/)
 * Writes skills/agent-graphs/generations/gen1-baseline.json and prints the per-case table.
 *
 * Author model: tangle-router glm-5.2, temperature 0.2, one retry on unparseable JSON.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type AnalystRegistry,
  defaultEdgeTraversalCap,
  type EdgeTraversal,
  GraphEdgeCapError,
  type GraphResult,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '../../src/runtime/index.ts'
import { leafSeam, scriptedBrain, type ScriptedTurn } from './agent-graphs-improve/offline-seams.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
// The skill was re-homed skills/codemode → skills/agent-graphs (925460fe); these paths follow it.
const SKILL_PATH = join(REPO, 'skills', 'agent-graphs', 'SKILL.md')
const CASES_DIR = join(REPO, 'skills', 'agent-graphs', 'cases')
const OUT_PATH = join(REPO, 'skills', 'agent-graphs', 'generations', 'gen1-baseline.json')
// The v1 surface + cases were removed from the working tree by 5b8d4da5 ("replace codemode plan
// with current graph guide"); the baseline still measures the v1 text, pinned in git history.
// Override with SKILL_REF to measure another committed version.
const SKILL_REF = process.env.SKILL_REF ?? 'afb40bc1'

function gitShow(ref: string, path: string): string {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: REPO, encoding: 'utf8' })
}

function gitLs(ref: string, path: string): string[] {
  return execFileSync('git', ['ls-tree', '--name-only', ref, `${path}/`], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((l) => l.endsWith('.json'))
}

/** The surface + cases: from the working tree when present, else pinned from git history. */
export function loadInputs(): { surface: string; cases: CaseSpec[]; source: string } {
  if (existsSync(SKILL_PATH)) {
    const surface = readFileSync(SKILL_PATH, 'utf8')
    const cases = readdirSync(CASES_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) as CaseSpec)
    return { surface, cases, source: 'working-tree' }
  }
  const surface = gitShow(SKILL_REF, 'skills/agent-graphs/SKILL.md')
  const cases = gitLs(SKILL_REF, 'skills/agent-graphs/cases')
    .sort()
    .map((p) => JSON.parse(gitShow(SKILL_REF, p)) as CaseSpec)
  return { surface, cases, source: `git:${SKILL_REF}` }
}

// The measured pi floor the floor-trap case scores against (src/runtime/supervise/budget-floor.ts).
const PI_TOKEN_FLOOR = 31_211
// "Budget generously" proxy for unmeasured harnesses: floor-unknown means per-child headroom
// well above the one measured floor; 50k is the scorer's line, documented not tuned.
const GENEROUS_PER_CHILD_TOKENS = 50_000

// ── Case + artifact shapes ─────────────────────────────────────────────────────

export interface CaseExpect {
  correctAnswerIsNoGraph?: boolean
  correctAnswerIsDynamicWorkflow?: boolean
  correctAnswerIsGraph?: boolean
  nodes?: number
  analyzesWarranted?: boolean
  floorTrap?: boolean
  mustBudgetAtLeast?: number
  correctAuthorOverridesBrief?: boolean
  maxTraversalsAtLeast?: number
  deliverableDescribeCarriesMission?: boolean
  checkIsMechanical?: boolean
  trapIsAnalyzesCapAsStop?: boolean
  correctStopIsDelegatesCapOrDeliverable?: boolean
  wrongIfAnalystIsNode?: boolean
  generousBudgetsBecauseFloorUnknown?: boolean
  edges?: string[]
  reason?: string
}

export interface CaseSpec {
  id: string
  brief: string
  expect: CaseExpect
}

export type AuthoredEdge =
  | { kind: 'delegates'; from: string; to: string; maxTraversals?: number }
  | { kind: 'analyzes'; analyst: string; over: string[]; to: string; maxTraversals?: number }

export interface AuthoredGraphSpec {
  nodes: Array<{ id: string; systemPrompt: string }>
  edges: AuthoredEdge[]
  budget: { maxIterations: number; maxTokens: number }
  perWorker?: { maxIterations?: number; maxTokens?: number }
  deliverableDescribe: string
}

export type Decision = 'graph' | 'single-agent' | 'dynamic-workflow'

export interface OfflineRunSummary {
  resultKind: string
  ledger: ReadonlyArray<EdgeTraversal>
  exhaustedEdges: ReadonlyArray<string>
}

/** Closure A's output: the authored artifact, plus the offline run evidence when one ran. */
export interface AuthoredArtifact {
  decision: Decision
  reason: string
  graph?: AuthoredGraphSpec
  run?: OfflineRunSummary
  /** A `runGraph`/`validateGraph` refusal (or offline-run fault) — captured as data. */
  validationError?: string
  /** The author model's raw reply, retained for audit. */
  raw: string
}

// ── The author model call ──────────────────────────────────────────────────────

const ROUTER_URL = 'https://router.tangle.tools/v1/chat/completions'
const AUTHOR_MODEL = 'glm-5.2'

function routerToken(): string {
  const raw = readFileSync(join(homedir(), '.config', 'tangle', 'router-token.json'), 'utf8')
  return (JSON.parse(raw) as { token: string }).token
}

function authorPrompt(surface: string, kase: CaseSpec): string {
  return [
    'You are an agent-graph author. Follow the skill below EXACTLY — it is your only doctrine.',
    '',
    '<skill>',
    surface,
    '</skill>',
    '',
    `<case-brief id="${kase.id}">`,
    kase.brief,
    '</case-brief>',
    '',
    'First decide the dialect per the skill. Then reply with JSON ONLY — no markdown fences, no prose outside the JSON:',
    '{"decision":"graph"|"single-agent"|"dynamic-workflow","reason":string,"graph"?:{...}}',
    '',
    'Include "graph" if and only if decision is "graph", with this exact shape:',
    '{"nodes":[{"id":string,"systemPrompt":string}, ...],',
    ' "edges":[{"kind":"delegates","from":string,"to":string,"maxTraversals"?:number}',
    '        | {"kind":"analyzes","analyst":string,"over":[string,...],"to":string,"maxTraversals"?:number}, ...],',
    ' "budget":{"maxIterations":number,"maxTokens":number},',
    ' "perWorker"?:{"maxIterations"?:number,"maxTokens"?:number},',
    ' "deliverableDescribe":string}',
    '',
    'Rules: the root node must be listed first in "nodes"; every delegates edge originates at the root;',
    'analysts are registry lens ids, never node ids; "deliverableDescribe" is the driver\'s real mission text.',
  ].join('\n')
}

function extractJson(text: string): string {
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found in author reply')
  return stripped.slice(start, end + 1)
}

export async function callAuthor(prompt: string, temperature = 0.2, maxTokens = 6000): Promise<string> {
  const res = await fetch(ROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${routerToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AUTHOR_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok) throw new Error(`router HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('router returned empty content')
  }
  return content
}

interface AuthoredReply {
  decision: Decision
  reason: string
  graph?: AuthoredGraphSpec
  raw: string
}

/** Prompt the author; one retry on unparseable JSON (or a transport fault). */
async function authorOnce(surface: string, kase: CaseSpec): Promise<AuthoredReply> {
  const prompt = authorPrompt(surface, kase)
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callAuthor(prompt)
      const parsed = JSON.parse(extractJson(raw)) as {
        decision?: string
        reason?: string
        graph?: AuthoredGraphSpec
      }
      const decision = parsed.decision
      if (decision !== 'graph' && decision !== 'single-agent' && decision !== 'dynamic-workflow') {
        throw new Error(`author decision '${String(decision)}' is not in the contract`)
      }
      return {
        decision,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        ...(parsed.graph !== undefined ? { graph: parsed.graph } : {}),
        raw,
      }
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`author failed after retry: ${String((lastErr as Error)?.message ?? lastErr)}`)
}

// ── Lowering an authored spec to a real AgentGraph + offline execution ─────────

function findRootId(spec: AuthoredGraphSpec): string {
  const delegatesTo = new Set(
    spec.edges.filter((e) => e.kind === 'delegates').map((e) => (e as { to: string }).to),
  )
  const candidates = spec.nodes.filter((n) => !delegatesTo.has(n.id))
  const fromIds = new Set(
    spec.edges.filter((e) => e.kind === 'delegates').map((e) => (e as { from: string }).from),
  )
  const root = candidates.find((n) => fromIds.has(n.id)) ?? candidates[0] ?? spec.nodes[0]
  if (!root) throw new Error('authored graph has no nodes')
  return root.id
}

/** Execute the authored graph offline: scripted driver (spawn each worker once, await each
 *  settle, then finish) + stub leaves + in-memory journal/blobs. */
async function runAuthoredOffline(spec: AuthoredGraphSpec, runId: string): Promise<OfflineRunSummary> {
  const rootId = findRootId(spec)
  const workerIds = spec.nodes.map((n) => n.id).filter((id) => id !== rootId)

  const graph: AgentGraph = {
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      profile: { name: n.id, prompt: { systemPrompt: n.systemPrompt } },
    })),
    edges: spec.edges.map((e) =>
      e.kind === 'delegates'
        ? {
            kind: 'delegates' as const,
            from: e.from,
            to: e.to,
            directive: promptHandle('delegates/worker-brief/v1'),
            ...(e.maxTraversals !== undefined ? { maxTraversals: e.maxTraversals } : {}),
          }
        : {
            kind: 'analyzes' as const,
            analyst: e.analyst,
            over: e.over,
            to: e.to,
            directive: promptHandle('analyzes/findings-report/v1'),
            ...(e.maxTraversals !== undefined ? { maxTraversals: e.maxTraversals } : {}),
          },
    ),
    // Offline stamp — the ledger is what we score, not deliverable quality.
    deliverable: { describe: spec.deliverableDescribe, check: (out) => out !== undefined },
    budget: spec.budget,
  }

  // Lenses for whatever analyst ids the author named: ENVIRONMENT, never nodes.
  const analystIds = [
    ...new Set(
      spec.edges.filter((e) => e.kind === 'analyzes').map((e) => (e as { analyst: string }).analyst),
    ),
  ]
  const analysts: AnalystRegistry | undefined =
    analystIds.length > 0
      ? {
          kinds: analystIds.map((id) => ({
            id,
            description: `offline stub lens '${id}'`,
            area: 'review',
          })),
          run: async () => [{ claim: 'offline stub finding', severity: 'minor' }],
        }
      : undefined

  const received: AgentProfile[] = []
  const turns: ScriptedTurn[] = [
    {
      toolCalls: workerIds.map((id) => ({
        name: 'spawn_agent',
        arguments: { profile: { name: id }, task: `work the '${id}' role` },
      })),
    },
    ...workerIds.map(() => ({ toolCalls: [{ name: 'await_event', arguments: {} }] })),
    { content: 'done' },
  ]

  const opts: RunGraphOptions = {
    runId,
    maxLiveWorkers: Math.max(workerIds.length, 1),
    ...(spec.perWorker !== undefined ? { perWorker: spec.perWorker } : {}),
    ...(analysts !== undefined ? { analysts } : {}),
    makeWorkerAgent: leafSeam(
      received,
      Object.fromEntries(workerIds.map((id) => [id, { withTrace: true }])),
    ),
    brain: scriptedBrain(turns),
  }

  const timeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error('offline run timed out (120s)')), 120_000)
    t.unref?.()
  })
  const res: GraphResult = await Promise.race([runGraph(graph, opts), timeout])
  return { resultKind: res.result.kind, ledger: res.ledger, exhaustedEdges: res.exhaustedEdges }
}

/** CLOSURE A — `dispatchWithSurface(surface, scenario)`: author from the skill text, lower,
 *  execute offline. A refusal is data (`validationError`), never a crash. */
export async function dispatchWithSurface(surface: string, scenario: CaseSpec): Promise<AuthoredArtifact> {
  const reply = await authorOnce(surface, scenario)
  const artifact: AuthoredArtifact = {
    decision: reply.decision,
    reason: reply.reason,
    ...(reply.graph !== undefined ? { graph: reply.graph } : {}),
    raw: reply.raw,
  }
  if (reply.decision !== 'graph' || reply.graph === undefined) return artifact
  try {
    artifact.run = await runAuthoredOffline(reply.graph, `codemode-${scenario.id}`)
  } catch (err) {
    if (err instanceof GraphEdgeCapError) {
      // Cap exhaustion still carries the full ledger — keep the evidence AND the refusal.
      artifact.run = {
        resultKind: 'edge-cap-error',
        ledger: err.ledger,
        exhaustedEdges: err.exhaustedEdges,
      }
      artifact.validationError = err.message
    } else {
      artifact.validationError = err instanceof Error ? err.message : String(err)
    }
  }
  return artifact
}

// ── Closure B: the deterministic scorer ────────────────────────────────────────

interface Check {
  key: string
  pass: boolean
  note: string
}

const STOPWORDS = new Set([
  'should', 'would', 'could', 'about', 'before', 'after', 'their', 'there', 'these', 'those',
  'thing', 'whole', 'based', 'little', 'produce', 'passes',
])

/** Salient domain words of a brief: length ≥ 6, minus function words. */
function domainWords(brief: string): string[] {
  return [
    ...new Set(
      brief
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 6 && !STOPWORDS.has(w)),
    ),
  ]
}

function perChildTokens(spec: AuthoredGraphSpec): number {
  // The skill's documented default: perWorker unset means a quarter of the pool.
  return spec.perWorker?.maxTokens ?? Math.floor(spec.budget.maxTokens / 4)
}

function delegatesEdges(spec: AuthoredGraphSpec): Array<Extract<AuthoredEdge, { kind: 'delegates' }>> {
  return spec.edges.filter((e): e is Extract<AuthoredEdge, { kind: 'delegates' }> => e.kind === 'delegates')
}

function analyzesEdges(spec: AuthoredGraphSpec): Array<Extract<AuthoredEdge, { kind: 'analyzes' }>> {
  return spec.edges.filter((e): e is Extract<AuthoredEdge, { kind: 'analyzes' }> => e.kind === 'analyzes')
}

function ledgerTraversals(run: OfflineRunSummary | undefined, edgePrefix: string): number {
  if (!run) return 0
  return run.ledger.filter((row) => row.edge.startsWith(edgePrefix)).length
}

/** CLOSURE B — deterministic `JudgeConfig`-style scorer: each `expect` entry becomes one
 *  mechanical check; score = satisfied / total, equal weights. */
export function judgeArtifact(artifact: AuthoredArtifact, kase: CaseSpec): { score: number; reasons: string[] } {
  const e = kase.expect
  const g = artifact.graph
  const checks: Check[] = []
  const graphOk = artifact.decision === 'graph' && g !== undefined

  if (e.correctAnswerIsNoGraph !== undefined) {
    checks.push({
      key: 'correctAnswerIsNoGraph',
      pass: artifact.decision === 'single-agent',
      note: `decision=${artifact.decision}`,
    })
  }
  if (e.correctAnswerIsDynamicWorkflow !== undefined) {
    checks.push({
      key: 'correctAnswerIsDynamicWorkflow',
      pass: artifact.decision === 'dynamic-workflow',
      note: `decision=${artifact.decision}`,
    })
  }
  if (e.correctAnswerIsGraph !== undefined) {
    // Explicit dialect check for cases whose whole point is that a cheap-sounding brief
    // still warrants a graph; requires an authored graph, not just the word "graph".
    checks.push({
      key: 'correctAnswerIsGraph',
      pass: graphOk,
      note: `decision=${artifact.decision}${artifact.decision === 'graph' && g === undefined ? ' (no graph payload)' : ''}`,
    })
  }
  if (e.mustBudgetAtLeast !== undefined) {
    const perChild = graphOk ? perChildTokens(g) : 0
    checks.push({
      key: 'mustBudgetAtLeast',
      pass: graphOk && perChild >= e.mustBudgetAtLeast,
      note: graphOk
        ? `per-child tokens ${perChild} vs floor ${e.mustBudgetAtLeast} (pi floor ${PI_TOKEN_FLOOR})`
        : `no graph authored (decision=${artifact.decision})`,
    })
  }
  if (e.nodes !== undefined) {
    const total = graphOk ? g.nodes.length : 0
    const workers = graphOk ? Math.max(total - 1, 0) : 0
    checks.push({
      key: 'nodes',
      // The case files don't say whether the count includes the root; accept either reading.
      pass: graphOk && (workers === e.nodes || total === e.nodes),
      note: graphOk ? `workers=${workers} total=${total} expected=${e.nodes}` : 'no graph authored',
    })
  }
  if (e.maxTraversalsAtLeast !== undefined) {
    const caps = graphOk ? delegatesEdges(g).map((d) => d.maxTraversals ?? defaultEdgeTraversalCap) : []
    const best = caps.length > 0 ? Math.max(...caps) : 0
    checks.push({
      key: 'maxTraversalsAtLeast',
      pass: graphOk && best >= e.maxTraversalsAtLeast,
      note: graphOk
        ? `effective delegates cap ${best} (default ${defaultEdgeTraversalCap} when unset) vs ≥${e.maxTraversalsAtLeast}`
        : 'no graph authored',
    })
  }
  if (e.deliverableDescribeCarriesMission !== undefined) {
    const describe = graphOk ? g.deliverableDescribe ?? '' : ''
    const words = domainWords(kase.brief)
    const hit = words.filter((w) => describe.toLowerCase().includes(w))
    checks.push({
      key: 'deliverableDescribeCarriesMission',
      pass: graphOk && describe.length > 40 && hit.length > 0,
      note: graphOk
        ? `describe ${describe.length} chars, domain words hit: [${hit.join(', ')}] of [${words.join(', ')}]`
        : 'no graph authored',
    })
  }
  if (e.trapIsAnalyzesCapAsStop !== undefined) {
    // The trap is sprung when the ONLY cap in the graph sits on an analyzes edge — i.e. the
    // author treated the observability cap as the stop. A delegates cap or a deliverable-based
    // stop alongside it means the author dodged the trap.
    const anCaps = graphOk ? analyzesEdges(g).some((a) => a.maxTraversals !== undefined) : false
    const delCaps = graphOk ? delegatesEdges(g).some((d) => d.maxTraversals !== undefined) : false
    const sprung = graphOk && anCaps && !delCaps
    checks.push({
      key: 'trapIsAnalyzesCapAsStop',
      pass: graphOk && !sprung,
      note: graphOk
        ? `analyzes caps=${anCaps} delegates caps=${delCaps}${sprung ? ' — trap sprung' : ''}`
        : 'no graph authored',
    })
  }
  if (e.correctStopIsDelegatesCapOrDeliverable !== undefined) {
    const delCaps = graphOk ? delegatesEdges(g).some((d) => d.maxTraversals !== undefined) : false
    const mentionsDeliverable = /deliverable/i.test(artifact.reason)
    checks.push({
      key: 'correctStopIsDelegatesCapOrDeliverable',
      pass: graphOk && (delCaps || mentionsDeliverable),
      note: graphOk
        ? `delegates caps=${delCaps}, reason mentions deliverable=${mentionsDeliverable}`
        : 'no graph authored',
    })
  }
  if (e.analyzesWarranted !== undefined) {
    const has = graphOk ? analyzesEdges(g).length > 0 : false
    checks.push({
      key: 'analyzesWarranted',
      pass: graphOk && has === e.analyzesWarranted,
      note: graphOk ? `analyzes edges=${analyzesEdges(g).length} warranted=${e.analyzesWarranted}` : 'no graph authored',
    })
  }
  if (e.wrongIfAnalystIsNode !== undefined) {
    const nodeIds = graphOk ? new Set(g.nodes.map((n) => n.id)) : new Set<string>()
    const offenders = graphOk ? analyzesEdges(g).filter((a) => nodeIds.has(a.analyst)) : []
    checks.push({
      key: 'wrongIfAnalystIsNode',
      pass: graphOk && offenders.length === 0,
      note: graphOk
        ? offenders.length === 0
          ? 'no analyst id collides with a node id'
          : `analyst ids that are nodes: ${offenders.map((o) => o.analyst).join(', ')}`
        : 'no graph authored',
    })
  }
  if (e.generousBudgetsBecauseFloorUnknown !== undefined) {
    const perChild = graphOk ? perChildTokens(g) : 0
    checks.push({
      key: 'generousBudgetsBecauseFloorUnknown',
      pass: graphOk && perChild >= GENEROUS_PER_CHILD_TOKENS,
      note: graphOk
        ? `per-child tokens ${perChild} vs generous line ${GENEROUS_PER_CHILD_TOKENS}`
        : 'no graph authored',
    })
  }
  if (e.edges !== undefined) {
    for (const want of e.edges) {
      if (/delegates/i.test(want)) {
        const rootId = graphOk ? findRootId(g) : ''
        const workers = graphOk ? g.nodes.map((n) => n.id).filter((id) => id !== rootId) : []
        const covered = graphOk
          ? workers.every(
              (id) =>
                delegatesEdges(g).some((d) => d.to === id) &&
                ledgerTraversals(artifact.run, `delegates:${rootId}->${id}`) > 0,
            )
          : false
        checks.push({
          key: `edge:${want}`,
          pass: graphOk && workers.length > 0 && covered,
          note: graphOk
            ? `workers [${workers.join(', ')}] each delegated-to with >0 ledger traversals: ${covered}`
            : 'no graph authored',
        })
      } else if (/analyzes/i.test(want)) {
        const rootId = graphOk ? findRootId(g) : ''
        const toRoot = graphOk ? analyzesEdges(g).filter((a) => a.to === rootId) : []
        const fired = toRoot.some((a) => ledgerTraversals(artifact.run, `analyzes:${a.analyst}:`) > 0)
        checks.push({
          key: `edge:${want}`,
          pass: graphOk && toRoot.length > 0 && fired,
          note: graphOk
            ? `analyzes→root edges=${toRoot.length}, fired with >0 traversals=${fired}`
            : 'no graph authored',
        })
      } else {
        checks.push({ key: `edge:${want}`, pass: false, note: 'unrecognized edge expectation' })
      }
    }
  }

  const total = checks.length
  const passed = checks.filter((c) => c.pass).length
  const score = total === 0 ? 0 : passed / total
  const reasons = checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.key}: ${c.note}`)
  if (artifact.validationError !== undefined) {
    reasons.push(`validationError: ${artifact.validationError}`)
  }
  return { score, reasons }
}

// ── The baseline run ───────────────────────────────────────────────────────────

interface CaseResult {
  id: string
  decision: Decision
  score: number
  reasons: string[]
  validationError?: string
  reason: string
  authoredGraph?: AuthoredGraphSpec
  runResultKind?: string
  ledgerRows?: number
  exhaustedEdges?: ReadonlyArray<string>
}

async function main(): Promise<void> {
  const inputs = loadInputs()
  const surface = inputs.surface
  // CASE=<id> runs a subset — the smoke lever; the baseline artifact is only written on a full run.
  const only = process.env.CASE
  const cases: CaseSpec[] = inputs.cases.filter((c) => only === undefined || c.id === only)

  console.log(
    `codemode baseline: skill v1 (${surface.length} chars, source=${inputs.source}), ${cases.length} cases, author=${AUTHOR_MODEL}`,
  )

  const results: CaseResult[] = []
  for (const kase of cases) {
    const t0 = Date.now()
    process.stdout.write(`  ${kase.id} … `)
    try {
      const artifact = await dispatchWithSurface(surface, kase)
      const { score, reasons } = judgeArtifact(artifact, kase)
      results.push({
        id: kase.id,
        decision: artifact.decision,
        score,
        reasons,
        ...(artifact.validationError !== undefined ? { validationError: artifact.validationError } : {}),
        reason: artifact.reason,
        ...(artifact.graph !== undefined ? { authoredGraph: artifact.graph } : {}),
        ...(artifact.run !== undefined
          ? {
              runResultKind: artifact.run.resultKind,
              ledgerRows: artifact.run.ledger.length,
              exhaustedEdges: artifact.run.exhaustedEdges,
            }
          : {}),
      })
      console.log(`${artifact.decision} score=${score.toFixed(2)} (${Math.round((Date.now() - t0) / 1000)}s)`)
      for (const line of reasons.filter((x) => !x.startsWith('PASS'))) console.log(`      ${line}`)
    } catch (err) {
      // An author-transport failure is a null result for the case, recorded as such.
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        id: kase.id,
        decision: 'single-agent',
        score: 0,
        reasons: [`AUTHOR-FAILED: ${message}`],
        validationError: message,
        reason: '',
      })
      console.log(`AUTHOR-FAILED (${message.slice(0, 80)})`)
    }
  }

  const scores = results.map((r) => r.score).sort((a, b) => a - b)
  const mean = scores.reduce((s, x) => s + x, 0) / Math.max(scores.length, 1)
  // Interpolated median (average the middle pair on even n). The first baseline shipped
  // scores[floor(n/2)] — the UPPER middle on even n — and reported "median 1.0" over
  // [0, 0, 0.5, 0.6, 1, 1, 1, 1], overstating the skill. An aggregate that flatters the
  // surface under improvement corrupts every gate downstream of it.
  const mid = Math.floor(scores.length / 2)
  const median =
    scores.length === 0 ? 0
    : scores.length % 2 === 1 ? (scores[mid] ?? 0)
    : ((scores[mid - 1] ?? 0) + (scores[mid] ?? 0)) / 2

  const out = {
    skillVersion: 'v1',
    surfaceSource: inputs.source,
    authorModel: AUTHOR_MODEL,
    temperature: 0.2,
    date: new Date().toISOString(),
    n: results.length,
    aggregate: { mean, median, min: scores[0] ?? 0, max: scores[scores.length - 1] ?? 0 },
    cases: results,
  }
  const wrote = only === undefined
  if (wrote) {
    mkdirSync(dirname(OUT_PATH), { recursive: true })
    writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`)
  }

  console.log('\ncase                        decision           score  notes')
  console.log('─'.repeat(96))
  for (const r of results) {
    const fails = r.reasons.filter((x) => x.startsWith('FAIL')).length
    const total = r.reasons.filter((x) => /^(PASS|FAIL)/.test(x)).length
    console.log(
      `${r.id.padEnd(28)}${r.decision.padEnd(19)}${r.score.toFixed(2).padEnd(7)}${total - fails}/${total} checks${r.validationError ? '  [refusal captured]' : ''}`,
    )
  }
  console.log('─'.repeat(96))
  console.log(`mean=${mean.toFixed(3)} median=${median.toFixed(3)} min=${(scores[0] ?? 0).toFixed(2)} max=${(scores[scores.length - 1] ?? 0).toFixed(2)} n=${results.length}`)
  console.log(wrote ? `written: ${OUT_PATH}` : 'subset run (CASE set) — baseline artifact NOT written')
}

// Run the baseline only when executed directly; gen2 imports this module for its closures.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    process.exit(1)
  })
}
