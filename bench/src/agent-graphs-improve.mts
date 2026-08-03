/**
 * Agent-graphs skill improvement runner — the baseline half of skills/agent-graphs/IMPROVE.md.
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
 * Writes skills/agent-graphs/baseline-v1.json and prints the per-case table.
 *
 * Author execution: one canonical AgentProfile through the Runtime bridge executor.
 * Defaults to pi + Tangle Router + DeepSeek V4 Flash; every choice and retry count is overridable.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defineInlineResource,
  harnessTypeSchema,
  reasoningEffortSchema,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type AnalystRegistry,
  collectAgentTurn,
  createExecutor,
  defaultEdgeTraversalCap,
  type EdgeTraversal,
  GraphEdgeCapError,
  type GraphResult,
  promptHandle,
  type RunGraphOptions,
  runGraph,
  streamAgentTurn,
} from '../../src/runtime/index.ts'
import { leafSeam, scriptedBrain, type ScriptedTurn } from './agent-graphs-improve/offline-seams.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SKILL_PATH = join(REPO, 'skills', 'agent-graphs', 'SKILL.md')
const CASES_DIR = join(REPO, 'skills', 'agent-graphs', 'cases')
const OUT_PATH = join(REPO, 'skills', 'agent-graphs', 'baseline-v1.json')
// Set SKILL_REF to measure an exact committed agent-graphs surface and case set.
// With no ref, read the working tree and fail if its canonical files are absent.
const SKILL_REF = process.env.SKILL_REF

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

/** Load either one explicit commit or the canonical working-tree files, never a legacy alias. */
export function loadInputs(): { surface: string; cases: CaseSpec[]; source: string } {
  if (SKILL_REF !== undefined) {
    const surface = gitShow(SKILL_REF, 'skills/agent-graphs/SKILL.md')
    const cases = gitLs(SKILL_REF, 'skills/agent-graphs/cases')
      .sort()
      .map((p) => parseCase(gitShow(SKILL_REF, p), `${SKILL_REF}:${p}`))
    return { surface, cases, source: `git:${SKILL_REF}` }
  }

  const surface = readFileSync(SKILL_PATH, 'utf8')
  const cases = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseCase(readFileSync(join(CASES_DIR, f), 'utf8'), join(CASES_DIR, f)))
  return { surface, cases, source: 'working-tree' }
}

// The measured pi floor the floor-trap case scores against (src/runtime/supervise/budget-floor.ts).
const PI_TOKEN_FLOOR = 31_211
// ── Case + artifact shapes ─────────────────────────────────────────────────────

export interface CaseExpect {
  correctAnswerIsNoGraph?: boolean
  correctAnswerIsDynamicWorkflow?: boolean
  delegatedWorkers?: number
  analyzesWarranted?: boolean
  mustBudgetAtLeast?: number
  maxTraversalsAtLeast?: number
  deliverableDescribeCarriesMission?: boolean
  trapIsAnalyzesCapAsStop?: boolean
  correctStopIsDelegatesCapOrDeliverable?: boolean
  reasonMentionsUnknownBudget?: boolean
  edges?: string[]
}

export interface CaseSpec {
  id: string
  brief: string
  expect: CaseExpect
}

const SCORED_EXPECTATION_KEYS = new Set<keyof CaseExpect>([
  'correctAnswerIsNoGraph',
  'correctAnswerIsDynamicWorkflow',
  'delegatedWorkers',
  'analyzesWarranted',
  'mustBudgetAtLeast',
  'maxTraversalsAtLeast',
  'deliverableDescribeCarriesMission',
  'trapIsAnalyzesCapAsStop',
  'correctStopIsDelegatesCapOrDeliverable',
  'reasonMentionsUnknownBudget',
  'edges',
])

function parseCase(text: string, source: string): CaseSpec {
  const value = JSON.parse(text) as Partial<CaseSpec>
  if (!value.expect || typeof value.expect !== 'object' || Array.isArray(value.expect)) {
    throw new Error(`${source}: expect must be an object`)
  }
  const unknown = Object.keys(value.expect).filter(
    (key) => !SCORED_EXPECTATION_KEYS.has(key as keyof CaseExpect),
  )
  if (unknown.length > 0) {
    throw new Error(`${source}: unscored expectation keys: ${unknown.join(', ')}`)
  }
  if (typeof value.id !== 'string' || typeof value.brief !== 'string') {
    throw new Error(`${source}: id and brief must be strings`)
  }
  return value as CaseSpec
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
  /** Every paid attempt, including parse failures and retries. */
  authorAttempts: AuthorAttemptEvidence[]
}

// ── The author model call ──────────────────────────────────────────────────────

const DEFAULT_AUTHOR_SYSTEM_PROMPT = [
  'You are an agent-graph author.',
  'Follow the attached agent-graphs skill exactly; it is your only workflow doctrine.',
  'Decide whether the task needs one agent, a fixed AgentGraph, or a dynamic supervise workflow.',
  'Reply with JSON only: no markdown fences and no prose outside the JSON.',
  '{"decision":"graph"|"single-agent"|"dynamic-workflow","reason":string,"graph"?:{...}}',
  'Include "graph" if and only if decision is "graph", with this exact shape:',
  '{"nodes":[{"id":string,"systemPrompt":string}, ...],',
  ' "edges":[{"kind":"delegates","from":string,"to":string,"maxTraversals"?:number}',
  '        | {"kind":"analyzes","analyst":string,"over":[string,...],"to":string,"maxTraversals"?:number}, ...],',
  ' "budget":{"maxIterations":number,"maxTokens":number},',
  ' "perWorker"?:{"maxIterations"?:number,"maxTokens"?:number},',
  ' "deliverableDescribe":string}',
  'The root node must be first; every delegates edge starts at the root.',
  'An analyst is either a registered lens id or a graph node with no incoming delegation edge.',
  'The deliverable description is the driver mission, not a generic completion phrase.',
].join('\n')

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function optionalPositiveInteger(name: string, raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : positiveInteger(name, raw, 1)
}

/** The exact portable author definition; the skill under test remains a first-class resource. */
export function buildAgentGraphsAuthorProfile(
  surface: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentProfile {
  const harness = harnessTypeSchema.parse(env.AGENT_GRAPHS_AUTHOR_HARNESS ?? 'pi')
  const reasoningEffort = reasoningEffortSchema.parse(
    env.AGENT_GRAPHS_AUTHOR_REASONING_EFFORT ?? 'ultracode',
  )
  return {
    name: env.AGENT_GRAPHS_AUTHOR_PROFILE_NAME ?? 'agent-graphs-author',
    harness,
    model: {
      provider: env.AGENT_GRAPHS_AUTHOR_PROVIDER ?? 'tangle-router',
      default: env.AGENT_GRAPHS_AUTHOR_MODEL ?? 'deepseek-v4-flash',
      reasoningEffort,
    },
    prompt: {
      systemPrompt: env.AGENT_GRAPHS_AUTHOR_SYSTEM_PROMPT ?? DEFAULT_AUTHOR_SYSTEM_PROMPT,
    },
    resources: {
      failOnError: true,
      skills: [defineInlineResource('agent-graphs', surface)],
    },
  }
}

export function authorProfileLabel(profile: AgentProfile): string {
  return [profile.harness, profile.model?.provider, profile.model?.default]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('/')
}

function authorPrompt(kase: CaseSpec): string {
  return [
    `<case-brief id="${kase.id}">`,
    kase.brief,
    '</case-brief>',
    'Apply the attached skill to this case and return the required JSON object.',
  ].join('\n')
}

function extractJson(text: string): string {
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found in author reply')
  return stripped.slice(start, end + 1)
}

export interface AuthorAttemptEvidence {
  status: string
  usage?: { input: number; output: number; costUsd?: number; model?: string }
  raw?: string
  error?: string
}

class AuthoringFailedError extends Error {
  constructor(
    message: string,
    readonly attempts: AuthorAttemptEvidence[],
  ) {
    super(message)
    this.name = 'AuthoringFailedError'
  }
}

export async function callAuthor(
  profile: AgentProfile,
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  finalText: string
  status: string
  usage: { input: number; output: number; costUsd?: number; model?: string }
  error?: { message: string }
}> {
  const bridgeBearer = env.AGENT_GRAPHS_BRIDGE_BEARER ?? env.BRIDGE_BEARER
  if (!bridgeBearer) {
    throw new Error('AGENT_GRAPHS_BRIDGE_BEARER or BRIDGE_BEARER is required')
  }
  const bridgeUrl = env.AGENT_GRAPHS_BRIDGE_URL ?? env.BRIDGE_URL ?? 'http://127.0.0.1:3355'
  const timeoutMs = optionalPositiveInteger(
    'AGENT_GRAPHS_AUTHOR_TIMEOUT_MS',
    env.AGENT_GRAPHS_AUTHOR_TIMEOUT_MS,
  )
  const factory = createExecutor({
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    agentProfile: profile,
  })
  const turn = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', factory, agentRunName: profile.name ?? 'agent-graphs-author' },
      prompt,
      timeoutMs === undefined ? {} : { timeoutMs },
    ),
  )
  return {
    finalText: turn.finalText,
    status: turn.status,
    usage: turn.usage,
    ...(turn.error ? { error: { message: turn.error.message } } : {}),
  }
}

interface AuthoredReply {
  decision: Decision
  reason: string
  graph?: AuthoredGraphSpec
  raw: string
  authorAttempts: AuthorAttemptEvidence[]
}

/** Prompt the profile; every attempt is retained and the caller controls the retry count. */
async function authorOnce(
  surface: string,
  kase: CaseSpec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthoredReply> {
  const prompt = authorPrompt(kase)
  const profile = buildAgentGraphsAuthorProfile(surface, env)
  const attemptLimit = positiveInteger(
    'AGENT_GRAPHS_AUTHOR_ATTEMPTS',
    env.AGENT_GRAPHS_AUTHOR_ATTEMPTS,
    2,
  )
  const attempts: AuthorAttemptEvidence[] = []
  let lastErr: unknown
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    let evidence: AuthorAttemptEvidence | undefined
    try {
      const turn = await callAuthor(profile, prompt, env)
      evidence = {
        status: turn.status,
        usage: turn.usage,
        raw: turn.finalText,
        ...(turn.error ? { error: turn.error.message } : {}),
      }
      attempts.push(evidence)
      if (turn.status !== 'completed') {
        throw new Error(turn.error?.message ?? `author turn ended with status ${turn.status}`)
      }
      const raw = turn.finalText
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
        authorAttempts: attempts,
      }
    } catch (err) {
      if (evidence === undefined) {
        attempts.push({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      } else if (evidence.error === undefined) {
        evidence.error = err instanceof Error ? err.message : String(err)
      }
      lastErr = err
    }
  }
  throw new AuthoringFailedError(
    `author failed after ${attemptLimit} attempt${attemptLimit === 1 ? '' : 's'}: ${String((lastErr as Error)?.message ?? lastErr)}`,
    attempts,
  )
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
export async function runAuthoredOffline(
  spec: AuthoredGraphSpec,
  runId: string,
): Promise<OfflineRunSummary> {
  const rootId = findRootId(spec)
  const nodeIds = new Set(spec.nodes.map((node) => node.id))
  const workerIds = [
    ...new Set(
      spec.edges
        .filter((edge): edge is Extract<AuthoredEdge, { kind: 'delegates' }> =>
          edge.kind === 'delegates')
        .map((edge) => edge.to),
    ),
  ]
  const analystNodeIds = [
    ...new Set(
      spec.edges
        .filter((edge): edge is Extract<AuthoredEdge, { kind: 'analyzes' }> =>
          edge.kind === 'analyzes' && nodeIds.has(edge.analyst))
        .map((edge) => edge.analyst),
    ),
  ]

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

  // Only non-node analyst ids are registry lenses. A node id runs through the same
  // makeWorkerAgent path as every other graph node and must not also enter the registry.
  const analystIds = [
    ...new Set(
      spec.edges
        .filter((edge): edge is Extract<AuthoredEdge, { kind: 'analyzes' }> =>
          edge.kind === 'analyzes' && !nodeIds.has(edge.analyst))
        .map((edge) => edge.analyst),
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
  const analystNodeRuns = spec.edges
    .filter((edge): edge is Extract<AuthoredEdge, { kind: 'analyzes' }> =>
      edge.kind === 'analyzes' && nodeIds.has(edge.analyst))
    .reduce((sum, edge) => sum + edge.over.length, 0)
  const turns: ScriptedTurn[] = [
    {
      toolCalls: workerIds.map((id) => ({
        name: 'spawn_agent',
        arguments: { profile: { name: id }, task: `work the '${id}' role` },
      })),
    },
    ...Array.from({ length: workerIds.length + analystNodeRuns }, () => ({
      toolCalls: [{ name: 'await_event', arguments: {} }],
    })),
    { content: 'done' },
  ]

  const opts: RunGraphOptions = {
    runId,
    maxLiveWorkers: Math.max(workerIds.length, 1),
    ...(spec.perWorker !== undefined ? { perWorker: spec.perWorker } : {}),
    ...(analysts !== undefined ? { analysts } : {}),
    makeWorkerAgent: leafSeam(received, {
      ...Object.fromEntries(workerIds.map((id) => [id, { withTrace: true }])),
      ...Object.fromEntries(analystNodeIds.map((id) => [id, {}])),
    }),
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
export async function dispatchWithSurface(
  surface: string,
  scenario: CaseSpec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthoredArtifact> {
  const reply = await authorOnce(surface, scenario, env)
  const artifact: AuthoredArtifact = {
    decision: reply.decision,
    reason: reply.reason,
    ...(reply.graph !== undefined ? { graph: reply.graph } : {}),
    raw: reply.raw,
    authorAttempts: reply.authorAttempts,
  }
  if (reply.decision !== 'graph' || reply.graph === undefined) return artifact
  try {
    artifact.run = await runAuthoredOffline(reply.graph, `agent-graphs-${scenario.id}`)
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
  if (e.delegatedWorkers !== undefined) {
    const workers = graphOk ? delegatesEdges(g).length : 0
    checks.push({
      key: 'delegatedWorkers',
      pass: graphOk && workers === e.delegatedWorkers,
      note: graphOk
        ? `delegated workers=${workers} expected=${e.delegatedWorkers}`
        : 'no graph authored',
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
  if (e.reasonMentionsUnknownBudget !== undefined) {
    const namesUncertainty = /unknown|unmeasured|measure|not (?:yet )?(?:known|established)/i.test(
      artifact.reason,
    )
    checks.push({
      key: 'reasonMentionsUnknownBudget',
      pass: namesUncertainty === e.reasonMentionsUnknownBudget,
      note: `reason names unmeasured budget=${namesUncertainty}`,
    })
  }
  if (e.edges !== undefined) {
    for (const want of e.edges) {
      if (/delegates/i.test(want)) {
        const rootId = graphOk ? findRootId(g) : ''
        const workers = graphOk ? delegatesEdges(g).map((edge) => edge.to) : []
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
  authorAttempts: AuthorAttemptEvidence[]
  authorFailed?: true
}

export function baselineIsPublishable(
  only: string | undefined,
  results: ReadonlyArray<{ authorFailed?: true }>,
): boolean {
  return only === undefined && results.length > 0 && results.every((result) => !result.authorFailed)
}

async function main(): Promise<void> {
  const inputs = loadInputs()
  const surface = inputs.surface
  // CASE=<id> runs a subset — the smoke lever; the baseline artifact is only written on a full run.
  const only = process.env.CASE
  const cases: CaseSpec[] = inputs.cases.filter((c) => only === undefined || c.id === only)
  const authorProfile = buildAgentGraphsAuthorProfile(surface)

  console.log(
    `agent-graphs baseline: skill v1 (${surface.length} chars, source=${inputs.source}), ${cases.length} cases, author=${authorProfileLabel(authorProfile)}`,
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
        authorAttempts: artifact.authorAttempts,
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
        authorAttempts: err instanceof AuthoringFailedError ? err.attempts : [],
        authorFailed: true,
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

  const authorAttempts = results.flatMap((result) => result.authorAttempts)
  const usageReceipts = authorAttempts.flatMap((attempt) =>
    attempt.usage === undefined ? [] : [attempt.usage],
  )
  const costAccountingComplete =
    authorAttempts.length > 0 &&
    authorAttempts.every((attempt) => attempt.usage?.costUsd !== undefined)
  const authorUsage = {
    attempts: authorAttempts.length,
    usageReceipts: usageReceipts.length,
    input: usageReceipts.reduce((sum, usage) => sum + usage.input, 0),
    output: usageReceipts.reduce((sum, usage) => sum + usage.output, 0),
    costUsd: costAccountingComplete
      ? usageReceipts.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0)
      : null,
    costAccountingComplete,
  }

  const out = {
    skillVersion: 'v1',
    surfaceSource: inputs.source,
    authorProfile,
    authorModel: authorProfileLabel(authorProfile),
    temperature: null,
    date: new Date().toISOString(),
    n: results.length,
    aggregate: { mean, median, min: scores[0] ?? 0, max: scores[scores.length - 1] ?? 0 },
    authorUsage,
    cases: results,
  }
  const wrote = baselineIsPublishable(only, results)
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
  if (wrote) {
    console.log(`written: ${OUT_PATH}`)
  } else if (only !== undefined) {
    console.log('subset run (CASE set) — baseline artifact NOT written')
  } else {
    throw new Error(
      `baseline artifact NOT written: ${results.filter((result) => result.authorFailed).length}/${results.length} cases lacked a scorable author result`,
    )
  }
}

// Run the baseline only when executed directly; the improvement runner imports its closures.
const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    process.exit(1)
  })
}
