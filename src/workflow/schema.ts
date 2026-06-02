import { ValidationError } from '../errors'
import type { JsonSchema } from './types'

export function validateJsonSchemaDefinition(
  schema: unknown,
  path = '$',
): asserts schema is JsonSchema {
  const record = assertSchemaRecord(schema, path)
  const type = record.type
  switch (type) {
    case 'string':
      requireAllowedKeys(record, path, ['type', 'minLength', 'maxLength', 'enum'])
      optionalNonNegativeNumber(record.minLength, `${path}.minLength`, { integer: true })
      optionalNonNegativeNumber(record.maxLength, `${path}.maxLength`, { integer: true })
      optionalEnum(record.enum, path, 'string')
      return
    case 'number':
    case 'integer':
      requireAllowedKeys(record, path, ['type', 'minimum', 'maximum', 'enum'])
      optionalFiniteNumber(record.minimum, `${path}.minimum`)
      optionalFiniteNumber(record.maximum, `${path}.maximum`)
      optionalEnum(record.enum, path, type)
      return
    case 'boolean':
      requireAllowedKeys(record, path, ['type', 'enum'])
      optionalEnum(record.enum, path, 'boolean')
      return
    case 'null':
      requireAllowedKeys(record, path, ['type'])
      return
    case 'array':
      requireAllowedKeys(record, path, ['type', 'items', 'minItems', 'maxItems'])
      optionalNonNegativeNumber(record.minItems, `${path}.minItems`, { integer: true })
      optionalNonNegativeNumber(record.maxItems, `${path}.maxItems`, { integer: true })
      if (record.items !== undefined) validateJsonSchemaDefinition(record.items, `${path}.items`)
      return
    case 'object': {
      requireAllowedKeys(record, path, ['type', 'properties', 'required', 'additionalProperties'])
      if (record.properties !== undefined) {
        const properties = assertSchemaPlainRecord(record.properties, `${path}.properties`)
        for (const [key, child] of Object.entries(properties)) {
          validateJsonSchemaDefinition(child, `${path}.properties.${key}`)
        }
      }
      if (record.required !== undefined) {
        if (!Array.isArray(record.required)) {
          throw new ValidationError(`${path}.required: expected string array`)
        }
        for (const [index, value] of record.required.entries()) {
          if (typeof value !== 'string' || value.length === 0) {
            throw new ValidationError(`${path}.required[${index}]: expected non-empty string`)
          }
        }
      }
      if (
        record.additionalProperties !== undefined &&
        typeof record.additionalProperties !== 'boolean'
      ) {
        throw new ValidationError(`${path}.additionalProperties: expected boolean`)
      }
      return
    }
    default:
      throw new ValidationError(`${path}.type: expected supported JSON schema type`)
  }
}

export function validateJsonSchema(value: unknown, schema: JsonSchema, path = '$'): void {
  validateJsonSchemaDefinition(schema)
  switch (schema.type) {
    case 'string':
      assertType(typeof value === 'string', path, 'string')
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new ValidationError(`${path}: expected string length >= ${schema.minLength}`)
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new ValidationError(`${path}: expected string length <= ${schema.maxLength}`)
      }
      assertEnum(value, schema.enum, path)
      return
    case 'number':
      assertType(typeof value === 'number' && Number.isFinite(value), path, 'number')
      assertNumberBounds(value, schema.minimum, schema.maximum, path)
      assertEnum(value, schema.enum, path)
      return
    case 'integer':
      assertType(Number.isInteger(value), path, 'integer')
      assertNumberBounds(value as number, schema.minimum, schema.maximum, path)
      assertEnum(value as number, schema.enum, path)
      return
    case 'boolean':
      assertType(typeof value === 'boolean', path, 'boolean')
      assertEnum(value, schema.enum, path)
      return
    case 'null':
      assertType(value === null, path, 'null')
      return
    case 'array':
      assertType(Array.isArray(value), path, 'array')
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        throw new ValidationError(`${path}: expected array length >= ${schema.minItems}`)
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        throw new ValidationError(`${path}: expected array length <= ${schema.maxItems}`)
      }
      if (schema.items) {
        value.forEach((item, index) => {
          validateJsonSchema(item, schema.items!, `${path}[${index}]`)
        })
      }
      return
    case 'object':
      assertPlainObject(value, path)
      validateObject(value as Record<string, unknown>, schema, path)
      return
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: Extract<JsonSchema, { type: 'object' }>,
  path: string,
): void {
  for (const key of schema.required ?? []) {
    if (!(key in value)) throw new ValidationError(`${path}: missing required property ${key}`)
  }
  const properties = schema.properties ?? {}
  for (const [key, propSchema] of Object.entries(properties)) {
    if (key in value) validateJsonSchema(value[key], propSchema, `${path}.${key}`)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) throw new ValidationError(`${path}: unexpected property ${key}`)
    }
  }
}

function assertType(ok: boolean, path: string, expected: string): asserts ok {
  if (!ok) throw new ValidationError(`${path}: expected ${expected}`)
}

function assertPlainObject(value: unknown, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${path}: expected object`)
  }
}

function assertNumberBounds(
  value: number,
  minimum: number | undefined,
  maximum: number | undefined,
  path: string,
): void {
  if (minimum !== undefined && value < minimum) {
    throw new ValidationError(`${path}: expected number >= ${minimum}`)
  }
  if (maximum !== undefined && value > maximum) {
    throw new ValidationError(`${path}: expected number <= ${maximum}`)
  }
}

function assertEnum<T>(value: T, allowed: readonly T[] | undefined, path: string): void {
  if (allowed && !allowed.includes(value)) {
    throw new ValidationError(`${path}: expected one of ${allowed.map(String).join(', ')}`)
  }
}

function assertSchemaRecord(value: unknown, path: string): Record<string, unknown> {
  const record = assertSchemaPlainRecord(value, path)
  if (typeof record.type !== 'string' || record.type.length === 0) {
    throw new ValidationError(`${path}.type: expected non-empty string`)
  }
  return record
}

function assertSchemaPlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${path}: expected object`)
  }
  return value as Record<string, unknown>
}

function requireAllowedKeys(
  record: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new ValidationError(`${path}.${key}: unsupported schema keyword`)
  }
}

function optionalFiniteNumber(value: unknown, path: string): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${path}: expected finite number`)
  }
}

function optionalNonNegativeNumber(
  value: unknown,
  path: string,
  options: { integer?: boolean } = {},
): void {
  optionalFiniteNumber(value, path)
  if (value === undefined) return
  if ((value as number) < 0) throw new ValidationError(`${path}: expected non-negative number`)
  if (options.integer && !Number.isInteger(value)) {
    throw new ValidationError(`${path}: expected integer`)
  }
}

function optionalEnum(
  value: unknown,
  path: string,
  expected: 'string' | 'number' | 'integer' | 'boolean',
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new ValidationError(`${path}.enum: expected array`)
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}.enum[${index}]`
    if (expected === 'integer') {
      if (!Number.isInteger(item)) throw new ValidationError(`${itemPath}: expected integer`)
    } else if (expected === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        throw new ValidationError(`${itemPath}: expected finite number`)
      }
    } else if (typeof item !== expected) {
      throw new ValidationError(`${itemPath}: expected ${expected}`)
    }
  }
}
