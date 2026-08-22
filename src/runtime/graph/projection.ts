/**
 * The ONE pure projection a `data` edge may carry (agent-runtime#971): the bounded,
 * schema-preserving subset of ADC's collection helpers. Anything richer is a `script` NODE, so it
 * is journaled (`inputRef` → `outRef`), typed, and visible. Exactly one operator per projection.
 */
import { ValidationError } from '../../errors'
import {
  type Condition,
  evaluateCondition,
  parseConditionPath,
  resolveConditionPath,
  validateCondition,
} from './condition'

export type Projection =
  | { readonly path: string }
  | { readonly pick: ReadonlyArray<string> }
  | { readonly map: string }
  | { readonly filter: Condition }
  | { readonly first: true }
  | { readonly last: true }
  | { readonly count: true }

const PROJECTION_KEYS = ['path', 'pick', 'map', 'filter', 'first', 'last', 'count'] as const

/** Validate a projection: exactly one known operator, its argument well-formed. */
export function validateProjection(raw: unknown, context: string): Projection {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`${context}: a projection must be an object`)
  }
  const record = raw as Record<string, unknown>
  const keys = PROJECTION_KEYS.filter((key) => record[key] !== undefined)
  const unknown = Object.keys(record).filter(
    (key) => !(PROJECTION_KEYS as ReadonlyArray<string>).includes(key),
  )
  if (unknown.length > 0) {
    throw new ValidationError(
      `${context}: unknown projection key(s) ${unknown.join(', ')}; known: ${PROJECTION_KEYS.join(', ')}`,
    )
  }
  if (keys.length !== 1) {
    throw new ValidationError(
      `${context}: a projection carries exactly ONE of ${PROJECTION_KEYS.join('/')}`,
    )
  }
  const key = keys[0]
  if (key === 'path' || key === 'map') parseConditionPath(record[key] as string, context)
  if (key === 'pick') {
    const fields = record.pick
    if (
      !Array.isArray(fields) ||
      fields.length === 0 ||
      fields.some((f) => typeof f !== 'string')
    ) {
      throw new ValidationError(`${context}: pick must be a non-empty array of field names`)
    }
  }
  if (key === 'filter') validateCondition(record.filter, context)
  if ((key === 'first' || key === 'last' || key === 'count') && record[key] !== true) {
    throw new ValidationError(`${context}: ${key} must be literally true`)
  }
  return raw as Projection
}

/**
 * Apply a validated projection to an admitted payload. Collection operators over a non-array
 * refuse by name — a shape the author did not expect is a graph defect, not an empty result.
 */
export function applyProjection(value: unknown, projection: Projection, context: string): unknown {
  if ('path' in projection) {
    return resolveConditionPath(value, parseConditionPath(projection.path, context))
  }
  if ('pick' in projection) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ValidationError(`${context}: pick needs an object payload`)
    }
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const field of projection.pick) if (field in record) out[field] = record[field]
    return out
  }
  const collection = value
  if (!Array.isArray(collection)) {
    throw new ValidationError(`${context}: this projection needs an array payload`)
  }
  if ('map' in projection) {
    const steps = parseConditionPath(projection.map, context)
    return collection.map((element) => resolveConditionPath(element, steps))
  }
  if ('filter' in projection) {
    return collection.filter((element) => evaluateCondition(projection.filter, element))
  }
  if ('first' in projection) return collection[0]
  if ('last' in projection) return collection[collection.length - 1]
  return collection.length
}
