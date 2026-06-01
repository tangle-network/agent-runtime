import { ValidationError } from '../errors'
import type { JsonSchema } from './types'

export function validateJsonSchema(value: unknown, schema: JsonSchema, path = '$'): void {
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
