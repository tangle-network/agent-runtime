import { ValidationError } from '../errors'
import { validateJsonSchemaDefinition } from './schema'
import type {
  JsonSchema,
  WorkflowAgentOptions,
  WorkflowCheckpointOptions,
  WorkflowLoopOptions,
} from './types'

export function normalizeWorkflowAgentOptions(input: unknown): WorkflowAgentOptions {
  const record = normalizeOptionsRecord(input, 'agent')
  rejectUnknownOptionKeys(record, 'agent', ['label', 'metadata', 'schema', 'allowWorkflow'])
  const out: WorkflowAgentOptions = {}
  const label = optionalStringOption(record.label, 'agent.label')
  if (label !== undefined) out.label = label
  const metadata = optionalJsonRecordOption(record.metadata, 'agent.metadata')
  if (metadata !== undefined) out.metadata = metadata
  const schema = optionalJsonSchemaOption(record.schema, 'agent.schema')
  if (schema !== undefined) out.schema = schema
  if (record.allowWorkflow !== undefined) {
    if (typeof record.allowWorkflow !== 'boolean') {
      throw new ValidationError('agent.allowWorkflow: expected boolean')
    }
    out.allowWorkflow = record.allowWorkflow
  }
  return out
}

export function normalizeWorkflowLoopOptions(input: unknown): WorkflowLoopOptions {
  const record = normalizeOptionsRecord(input, 'loop')
  rejectUnknownOptionKeys(record, 'loop', ['label', 'metadata', 'schema'])
  return normalizeCheckpointLikeOptions(record, 'loop')
}

export function normalizeWorkflowCheckpointOptions(
  input: unknown,
  kind: 'verify' | 'analyzeTrace' | 'review',
): WorkflowCheckpointOptions {
  const record = normalizeOptionsRecord(input, kind)
  rejectUnknownOptionKeys(record, kind, ['label', 'metadata', 'schema'])
  return normalizeCheckpointLikeOptions(record, kind)
}

function normalizeCheckpointLikeOptions(
  record: Record<string, unknown>,
  kind: string,
): WorkflowCheckpointOptions {
  const out: WorkflowCheckpointOptions = {}
  const label = optionalStringOption(record.label, `${kind}.label`)
  if (label !== undefined) out.label = label
  const metadata = optionalJsonRecordOption(record.metadata, `${kind}.metadata`)
  if (metadata !== undefined) out.metadata = metadata
  const schema = optionalJsonSchemaOption(record.schema, `${kind}.schema`)
  if (schema !== undefined) out.schema = schema
  return out
}

function cloneJsonRecord(value: object, path: string): Record<string, unknown> {
  const out = cloneJsonValue(value, path)
  if (!out || typeof out !== 'object' || Array.isArray(out)) {
    throw new ValidationError(`${path}: expected object`)
  }
  return out as Record<string, unknown>
}

function cloneJsonValue(value: unknown, path: string, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${path}: expected finite JSON number`)
    return value
  }
  if (value === undefined) {
    throw new ValidationError(`${path}: expected JSON value, got undefined`)
  }
  if (typeof value !== 'object') {
    throw new ValidationError(`${path}: expected JSON value, got ${typeof value}`)
  }
  if (seen.has(value)) throw new ValidationError(`${path}: JSON value cannot contain cycles`)
  seen.add(value)
  try {
    if (Array.isArray(value)) return cloneJsonArray(value, path, seen)
    return clonePlainJsonObject(value, path, seen)
  } finally {
    seen.delete(value)
  }
}

function cloneJsonArray(value: unknown[], path: string, seen: Set<object>): unknown[] {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ValidationError(`${path}: symbol properties are not JSON`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const out: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index]
    if (!descriptor) throw new ValidationError(`${path}[${index}]: sparse arrays are not JSON`)
    if (!('value' in descriptor)) {
      throw new ValidationError(`${path}[${index}]: accessor properties are not allowed`)
    }
    out.push(cloneJsonValue(descriptor.value, `${path}[${index}]`, seen))
  }
  for (const key of Object.keys(descriptors)) {
    if (!/^\d+$/.test(key) && key !== 'length') {
      throw new ValidationError(`${path}.${key}: array properties are not JSON`)
    }
  }
  return out
}

function clonePlainJsonObject(
  value: object,
  path: string,
  seen: Set<object>,
): Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new ValidationError(`${path}: expected plain JSON object`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ValidationError(`${path}: symbol properties are not JSON`)
  }
  const out: Record<string, unknown> = {}
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new ValidationError(`${path}.${key}: unsafe object key`)
    }
    if (!('value' in descriptor)) {
      throw new ValidationError(`${path}.${key}: accessor properties are not allowed`)
    }
    out[key] = cloneJsonValue(descriptor.value, `${path}.${key}`, seen)
  }
  return out
}

function normalizeOptionsRecord(input: unknown, kind: string): Record<string, unknown> {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(`${kind} options must be an object`)
  }
  return cloneJsonRecord(input, `${kind} options`)
}

function rejectUnknownOptionKeys(
  record: Record<string, unknown>,
  kind: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new ValidationError(`${kind}.${key}: unsupported workflow option`)
  }
}

function optionalStringOption(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${path}: expected non-empty string`)
  }
  return value
}

function optionalJsonRecordOption(
  value: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${path}: expected object`)
  }
  return cloneJsonRecord(value, path)
}

function optionalJsonSchemaOption(value: unknown, path: string): JsonSchema | undefined {
  if (value === undefined) return undefined
  const schema = cloneJsonValue(value, path)
  validateJsonSchemaDefinition(schema, path)
  return schema
}
