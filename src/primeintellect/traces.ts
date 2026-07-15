import { type RunRecord, validateRunRecord } from '@tangle-network/agent-eval'

interface PrimeUsage {
  prompt_tokens: number
  completion_tokens: number
  cached_input_tokens?: number | null
  reasoning_tokens?: number | null
  cost?: number | null
}

interface PrimeTraceNode {
  parent?: number | null
  sampled?: boolean
  usage?: PrimeUsage | null
  message?: unknown
}

interface PrimeTimeSpan {
  start?: number
  end?: number
}

export interface PrimeIntellectTrace {
  id: string
  task: {
    type: string
    data: {
      idx: number
      name?: string | null
      split?: 'train' | 'eval'
      prompt?: unknown
      system_prompt?: string | null
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }
  }
  runtime?: unknown
  nodes: PrimeTraceNode[]
  rewards: Record<string, number>
  metrics: Record<string, number>
  info?: Record<string, unknown>
  extra_usage?: PrimeUsage[]
  is_completed?: boolean
  stop_condition?: string | null
  errors?: Array<{ type: string; message: string; traceback?: string | null }>
  timing?: {
    start?: number
    setup?: PrimeTimeSpan
    generation?: PrimeTimeSpan
    finalize?: PrimeTimeSpan
    scoring?: PrimeTimeSpan
  }
}

export interface PrimeIntellectTraceImportOptions {
  experimentId: string
  candidateId: string
  seed: number
  /** Snapshot-pinned model id required by RunRecord validation. */
  model: string
  promptHash: string
  configHash: string
  commitSha: string
}

export type PrimeIntellectImportDefaults = PrimeIntellectTraceImportOptions

/** Parse Prime's durable `traces.jsonl` and reject malformed rows with a line number. */
export function parsePrimeIntellectTraces(jsonl: string): PrimeIntellectTrace[] {
  const traces: PrimeIntellectTrace[] = []
  for (const [lineIndex, line] of jsonl.split('\n').entries()) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(
        `PrimeIntellect trace line ${lineIndex + 1} is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    traces.push(validateTrace(parsed, lineIndex + 1))
  }
  if (traces.length === 0) throw new Error('PrimeIntellect traces.jsonl contains no traces')
  return traces
}

/** Convert all Prime traces to agent-eval RunRecords while retaining one shared run config. */
export function importPrimeIntellectTraces(
  jsonl: string,
  defaults: PrimeIntellectImportDefaults,
): RunRecord[] {
  return parsePrimeIntellectTraces(jsonl).map((trace) =>
    primeIntellectTraceToRunRecord(trace, defaults),
  )
}

/** Project one complete Prime trace into the common agent-eval analysis row. */
export function primeIntellectTraceToRunRecord(
  trace: PrimeIntellectTrace,
  options: PrimeIntellectTraceImportOptions,
): RunRecord {
  const split = trace.task.data.split
  if (split !== 'train' && split !== 'eval') {
    throw new Error(`PrimeIntellect trace ${trace.id} has no train/eval split`)
  }
  const reward = sumFinite(Object.values(trace.rewards), `trace ${trace.id} rewards`)
  const usage = aggregateUsage([
    ...trace.nodes.map((node) => node.usage).filter((value): value is PrimeUsage => value != null),
    ...(trace.extra_usage ?? []),
  ])
  const errors = trace.errors ?? []
  const raw: Record<string, number> = {
    reward,
    'prime.turns': trace.nodes.filter((node) => node.sampled === true).length,
    'prime.branches': countBranches(trace.nodes),
    'prime.errors': errors.length,
    'prime.completed': trace.is_completed ? 1 : 0,
    'prime.cost_complete': usage.costComplete ? 1 : 0,
    'prime.reported_cost_usd': usage.reportedCostUsd,
  }
  for (const [name, value] of Object.entries(trace.rewards)) {
    raw[`reward.${name}`] = finite(value, `trace ${trace.id} reward ${name}`)
  }
  for (const [name, value] of Object.entries(trace.metrics)) {
    raw[`metric.${name}`] = finite(value, `trace ${trace.id} metric ${name}`)
  }

  const record: RunRecord = {
    runId: trace.id,
    experimentId: options.experimentId,
    candidateId: options.candidateId,
    seed: options.seed,
    model: options.model,
    promptHash: options.promptHash,
    configHash: options.configHash,
    commitSha: options.commitSha,
    wallMs: traceWallMs(trace),
    costUsd: usage.costComplete ? usage.reportedCostUsd : 0,
    costProvenance: usage.costComplete
      ? { kind: 'observed', usd: usage.reportedCostUsd }
      : { kind: 'uncaptured', usd: null },
    tokenUsage: {
      input: usage.input,
      output: usage.output,
      ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
      ...(usage.cached !== undefined ? { cached: usage.cached } : {}),
    },
    outcome: split === 'eval' ? { holdoutScore: reward, raw } : { searchScore: reward, raw },
    splitTag: split === 'eval' ? 'holdout' : 'search',
    scenarioId: trace.task.data.name ?? String(trace.task.data.idx),
    ...(errors[0] ? { failureMode: `primeintellect:${errors[0].type}:${errors[0].message}` } : {}),
  }
  return validateRunRecord(record)
}

function validateTrace(value: unknown, line: number): PrimeIntellectTrace {
  const trace = object(value, `PrimeIntellect trace line ${line}`)
  nonEmptyString(trace.id, `PrimeIntellect trace line ${line}.id`)
  const task = object(trace.task, `PrimeIntellect trace line ${line}.task`)
  nonEmptyString(task.type, `PrimeIntellect trace line ${line}.task.type`)
  const data = object(task.data, `PrimeIntellect trace line ${line}.task.data`)
  if (!Number.isSafeInteger(data.idx) || (data.idx as number) < 0) {
    throw new Error(
      `PrimeIntellect trace line ${line}.task.data.idx must be a non-negative integer`,
    )
  }
  if (!Array.isArray(trace.nodes)) {
    throw new Error(`PrimeIntellect trace line ${line}.nodes must be an array`)
  }
  for (const [index, rawNode] of trace.nodes.entries()) {
    const node = object(rawNode, `PrimeIntellect trace line ${line}.nodes[${index}]`)
    const parent = node.parent
    if (
      parent !== undefined &&
      parent !== null &&
      (!Number.isSafeInteger(parent) || (parent as number) < 0 || (parent as number) >= index)
    ) {
      throw new Error(
        `PrimeIntellect trace line ${line}.nodes[${index}].parent must reference an earlier node`,
      )
    }
    if (node.sampled !== undefined && typeof node.sampled !== 'boolean') {
      throw new Error(`PrimeIntellect trace line ${line}.nodes[${index}].sampled must be boolean`)
    }
    if (node.usage !== undefined && node.usage !== null) {
      validateUsage(node.usage, `PrimeIntellect trace line ${line}.nodes[${index}].usage`)
    }
  }
  validateNumberMap(trace.rewards, `PrimeIntellect trace line ${line}.rewards`)
  validateNumberMap(trace.metrics, `PrimeIntellect trace line ${line}.metrics`)
  if (trace.extra_usage !== undefined && !Array.isArray(trace.extra_usage)) {
    throw new Error(`PrimeIntellect trace line ${line}.extra_usage must be an array`)
  }
  for (const [index, usage] of (trace.extra_usage ?? []).entries()) {
    validateUsage(usage, `PrimeIntellect trace line ${line}.extra_usage[${index}]`)
  }
  if (trace.errors !== undefined && !Array.isArray(trace.errors)) {
    throw new Error(`PrimeIntellect trace line ${line}.errors must be an array`)
  }
  for (const [index, rawError] of (trace.errors ?? []).entries()) {
    const error = object(rawError, `PrimeIntellect trace line ${line}.errors[${index}]`)
    nonEmptyString(error.type, `PrimeIntellect trace line ${line}.errors[${index}].type`)
    nonEmptyString(error.message, `PrimeIntellect trace line ${line}.errors[${index}].message`)
    if (
      error.traceback !== undefined &&
      error.traceback !== null &&
      typeof error.traceback !== 'string'
    ) {
      throw new Error(
        `PrimeIntellect trace line ${line}.errors[${index}].traceback must be a string or null`,
      )
    }
  }
  if (trace.is_completed !== undefined && typeof trace.is_completed !== 'boolean') {
    throw new Error(`PrimeIntellect trace line ${line}.is_completed must be boolean`)
  }
  if (
    trace.stop_condition !== undefined &&
    trace.stop_condition !== null &&
    typeof trace.stop_condition !== 'string'
  ) {
    throw new Error(`PrimeIntellect trace line ${line}.stop_condition must be a string or null`)
  }
  if (trace.timing !== undefined) validateTiming(trace.timing, line)
  return value as PrimeIntellectTrace
}

function validateTiming(value: unknown, line: number): void {
  const timing = object(value, `PrimeIntellect trace line ${line}.timing`)
  optionalFinite(timing.start, `PrimeIntellect trace line ${line}.timing.start`)
  for (const phase of ['setup', 'generation', 'finalize', 'scoring']) {
    if (timing[phase] === undefined) continue
    const span = object(timing[phase], `PrimeIntellect trace line ${line}.timing.${phase}`)
    optionalFinite(span.start, `PrimeIntellect trace line ${line}.timing.${phase}.start`)
    optionalFinite(span.end, `PrimeIntellect trace line ${line}.timing.${phase}.end`)
  }
}

function aggregateUsage(usages: PrimeUsage[]): {
  input: number
  output: number
  reasoning?: number
  cached?: number
  reportedCostUsd: number
  costComplete: boolean
} {
  let input = 0
  let output = 0
  let reasoning = 0
  let cached = 0
  let costUsd = 0
  let sawReasoning = false
  let sawCached = false
  let costsReported = 0
  for (const [index, usage] of usages.entries()) {
    const prompt = nonNegative(usage.prompt_tokens, `usage[${index}].prompt_tokens`)
    const completion = nonNegative(usage.completion_tokens, `usage[${index}].completion_tokens`)
    const cachedInput = optionalNonNegative(
      usage.cached_input_tokens,
      `usage[${index}].cached_input_tokens`,
    )
    const reasoningTokens = optionalNonNegative(
      usage.reasoning_tokens,
      `usage[${index}].reasoning_tokens`,
    )
    const cost = optionalNonNegative(usage.cost, `usage[${index}].cost`)
    input += prompt + (cachedInput ?? 0)
    output += completion
    if (cachedInput !== undefined) {
      cached += cachedInput
      sawCached = true
    }
    if (reasoningTokens !== undefined) {
      reasoning += reasoningTokens
      sawReasoning = true
    }
    if (cost !== undefined) {
      costUsd += cost
      costsReported += 1
    }
  }
  if (reasoning > output) {
    throw new Error(
      `PrimeIntellect reasoning token total ${reasoning} exceeds output total ${output}`,
    )
  }
  return {
    input,
    output,
    ...(sawReasoning ? { reasoning } : {}),
    ...(sawCached ? { cached } : {}),
    reportedCostUsd: costUsd,
    costComplete: usages.length > 0 && costsReported === usages.length,
  }
}

function validateUsage(value: unknown, path: string): void {
  const usage = object(value, path)
  nonNegative(usage.prompt_tokens, `${path}.prompt_tokens`)
  nonNegative(usage.completion_tokens, `${path}.completion_tokens`)
  optionalNonNegative(usage.cached_input_tokens, `${path}.cached_input_tokens`)
  optionalNonNegative(usage.reasoning_tokens, `${path}.reasoning_tokens`)
  optionalNonNegative(usage.cost, `${path}.cost`)
}

function traceWallMs(trace: PrimeIntellectTrace): number {
  const timing = trace.timing
  if (!timing || typeof timing.start !== 'number' || !Number.isFinite(timing.start)) return 0
  const ends = [
    timing.setup?.end,
    timing.generation?.end,
    timing.finalize?.end,
    timing.scoring?.end,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (ends.length === 0) return 0
  return Math.max(0, (Math.max(...ends) - timing.start) * 1000)
}

function countBranches(nodes: PrimeTraceNode[]): number {
  if (nodes.length === 0) return 0
  const parents = new Set(
    nodes
      .map((node) => node.parent)
      .filter(
        (parent): parent is number => Number.isSafeInteger(parent) && (parent as number) >= 0,
      ),
  )
  return nodes.reduce((count, _node, index) => count + (parents.has(index) ? 0 : 1), 0)
}

function validateNumberMap(value: unknown, path: string): void {
  const map = object(value, path)
  for (const [key, entry] of Object.entries(map)) finite(entry, `${path}.${key}`)
}

function sumFinite(values: unknown[], path: string): number {
  return values.reduce<number>((sum, value, index) => sum + finite(value, `${path}[${index}]`), 0)
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}

function nonNegative(value: unknown, path: string): number {
  const parsed = finite(value, path)
  if (parsed < 0) throw new Error(`${path} must be non-negative`)
  return parsed
}

function optionalNonNegative(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return nonNegative(value, path)
}

function optionalFinite(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return finite(value, path)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}
