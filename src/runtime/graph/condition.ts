/**
 * The ONE predicate tree: every guard in a graph — an edge `guard`, a filter projection's
 * predicate — is this shape, evaluated by this evaluator, so `contains`, ordering and equality can
 * never mean two different things on two surfaces (adopted from ADC's `workflow-conditions`,
 * agent-runtime#968). A declarative tree keeps an untrusted predicate incapable of code execution;
 * the size and depth bounds keep a predicate authored once from burning CPU on every settle.
 *
 * No zod: the kernel's grain is a hand-written validator that throws `ValidationError` by name.
 */
import { ValidationError } from '../../errors'

/** The leaf comparison operators; `exists`/`truthy` are unary, the rest compare against `value`. */
export const CONDITION_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'exists',
  'truthy',
] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

/** Operators that compare against `value`; `exists`/`truthy` are unary and must omit it. */
const OPS_NEEDING_VALUE: ReadonlySet<ConditionOp> = new Set(
  CONDITION_OPS.filter((op) => op !== 'exists' && op !== 'truthy'),
)

export interface ConditionLeaf {
  /** Dotted path with `[N]` indexing into the guard context, e.g. `out.findings[0].severity`. */
  readonly path: string
  readonly op: ConditionOp
  readonly value?: unknown
}

export type Condition =
  | ConditionLeaf
  | { readonly all: ReadonlyArray<Condition> }
  | { readonly any: ReadonlyArray<Condition> }
  | { readonly not: Condition }

export const MAX_CONDITION_NODES = 40
export const MAX_CONDITION_DEPTH = 6
const MAX_PATH_LENGTH = 256
const MAX_PATH_SEGMENTS = 16
const PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u

type PathStep = string | number

/** Parse `a.b[0].c` into steps; refuse anything outside the bounded grammar. */
export function parseConditionPath(path: string, context: string): ReadonlyArray<PathStep> {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new ValidationError(
      `${context}: path must be a non-empty string of at most ${MAX_PATH_LENGTH} chars`,
    )
  }
  const steps: PathStep[] = []
  for (const part of path.split('.')) {
    const open = part.indexOf('[')
    const head = open === -1 ? part : part.slice(0, open)
    if (head.length > 0) {
      if (!PATH_SEGMENT.test(head)) {
        throw new ValidationError(
          `${context}: path segment ${JSON.stringify(head)} is not addressable`,
        )
      }
      steps.push(head)
    } else if (open !== 0 || steps.length === 0) {
      throw new ValidationError(`${context}: path ${JSON.stringify(path)} has an empty segment`)
    }
    let rest = open === -1 ? '' : part.slice(open)
    while (rest.length > 0) {
      const match = /^\[(\d{1,6})\]/u.exec(rest)
      if (!match) {
        throw new ValidationError(`${context}: path index in ${JSON.stringify(part)} must be [N]`)
      }
      steps.push(Number(match[1]))
      rest = rest.slice(match[0].length)
    }
    if (steps.length > MAX_PATH_SEGMENTS) {
      throw new ValidationError(`${context}: path exceeds ${MAX_PATH_SEGMENTS} segments`)
    }
  }
  if (steps.length === 0) throw new ValidationError(`${context}: path resolves no segment`)
  return steps
}

/** Walk a parsed path; any miss resolves `undefined`, never a throw — absence is an answer. */
export function resolveConditionPath(context: unknown, steps: ReadonlyArray<PathStep>): unknown {
  let current: unknown = context
  for (const step of steps) {
    if (current === null || current === undefined) return undefined
    if (typeof step === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[step]
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined
      current = (current as Record<string, unknown>)[step]
    }
  }
  return current
}

function isLeaf(condition: Condition): condition is ConditionLeaf {
  return typeof (condition as ConditionLeaf).path === 'string'
}

/** Validate shape, bounds, and per-leaf path/operator rules; returns the input for chaining. */
export function validateCondition(raw: unknown, context: string): Condition {
  let nodes = 0
  const walk = (value: unknown, depth: number): Condition => {
    nodes += 1
    if (nodes > MAX_CONDITION_NODES) {
      throw new ValidationError(`${context}: condition exceeds ${MAX_CONDITION_NODES} nodes`)
    }
    if (depth > MAX_CONDITION_DEPTH) {
      throw new ValidationError(`${context}: condition exceeds depth ${MAX_CONDITION_DEPTH}`)
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ValidationError(`${context}: a condition must be an object`)
    }
    const record = value as Record<string, unknown>
    const combinators = ['all', 'any', 'not'].filter((key) => record[key] !== undefined)
    if (combinators.length > 1) {
      throw new ValidationError(
        `${context}: a condition carries ONE of all/any/not, got ${combinators.join('+')}`,
      )
    }
    if (record.all !== undefined || record.any !== undefined) {
      const key = record.all !== undefined ? 'all' : 'any'
      const branch = record[key]
      if (!Array.isArray(branch) || branch.length === 0) {
        throw new ValidationError(`${context}: ${key} must be a non-empty array`)
      }
      for (const child of branch) walk(child, depth + 1)
      return value as Condition
    }
    if (record.not !== undefined) {
      walk(record.not, depth + 1)
      return value as Condition
    }
    const op = record.op
    if (typeof record.path !== 'string' || typeof op !== 'string') {
      throw new ValidationError(`${context}: a leaf needs { path, op }`)
    }
    if (!(CONDITION_OPS as ReadonlyArray<string>).includes(op)) {
      throw new ValidationError(
        `${context}: unknown op ${JSON.stringify(op)}; known: ${CONDITION_OPS.join(', ')}`,
      )
    }
    parseConditionPath(record.path, context)
    const needsValue = OPS_NEEDING_VALUE.has(op as ConditionOp)
    if (needsValue && !('value' in record)) {
      throw new ValidationError(`${context}: op ${JSON.stringify(op)} requires a value`)
    }
    if (!needsValue && 'value' in record) {
      throw new ValidationError(`${context}: op ${JSON.stringify(op)} is unary — remove value`)
    }
    if (op === 'in' && !Array.isArray(record.value)) {
      throw new ValidationError(`${context}: op "in" takes an array value`)
    }
    return value as Condition
  }
  return walk(raw, 1)
}

function canonicalEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function ordering(op: 'gt' | 'gte' | 'lt' | 'lte', left: unknown, right: unknown): boolean {
  // Numbers order with numbers and strings with strings; a mixed or non-orderable pair is false,
  // never a coercion.
  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left) || Number.isNaN(right)) return false
    if (op === 'gt') return left > right
    if (op === 'gte') return left >= right
    if (op === 'lt') return left < right
    return left <= right
  }
  if (typeof left === 'string' && typeof right === 'string') {
    if (op === 'gt') return left > right
    if (op === 'gte') return left >= right
    if (op === 'lt') return left < right
    return left <= right
  }
  return false
}

/** Walk a validated condition over a context to a boolean. Never throws on data shape. */
export function evaluateCondition(condition: Condition, context: unknown): boolean {
  if (isLeaf(condition)) {
    const resolved = resolveConditionPath(context, parseConditionPath(condition.path, 'evaluate'))
    switch (condition.op) {
      case 'exists':
        return resolved !== undefined && resolved !== null
      case 'truthy':
        return Boolean(resolved)
      case 'eq':
        return canonicalEquals(resolved, condition.value)
      case 'neq':
        return !canonicalEquals(resolved, condition.value)
      case 'in':
        return Array.isArray(condition.value)
          ? condition.value.some((candidate) => canonicalEquals(resolved, candidate))
          : false
      case 'contains':
        if (Array.isArray(resolved)) {
          return resolved.some((element) => canonicalEquals(element, condition.value))
        }
        return typeof resolved === 'string' && typeof condition.value === 'string'
          ? resolved.includes(condition.value)
          : false
      default:
        return ordering(condition.op, resolved, condition.value)
    }
  }
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, context))
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, context))
  return !evaluateCondition(condition.not, context)
}
