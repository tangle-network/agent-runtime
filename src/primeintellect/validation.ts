import type { PrimeIntellectJson, PrimeIntellectMessage } from './types'

/** Validate the Verifiers v1 prompt schema shared by package creation and runner input. */
export function validatePrimeIntellectPrompt(
  value: unknown,
  path: string,
): string | PrimeIntellectMessage[] {
  if (typeof value === 'string' && value.length > 0) return value
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty string or message array`)
  }
  for (const [index, message] of value.entries()) {
    validateMessage(message, `${path}[${index}]`)
  }
  return value as PrimeIntellectMessage[]
}

export function validatePrimeIntellectJson(value: unknown, path: string): void {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validatePrimeIntellectJson(entry, `${path}[${index}]`)
    })
    return
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      validatePrimeIntellectJson(entry, `${path}.${key}`)
    }
    return
  }
  throw new Error(`${path} is not JSON serializable`)
}

export function validatePrimeIntellectJsonObject(
  value: unknown,
  path: string,
): Record<string, PrimeIntellectJson> {
  const output = record(value, path)
  validatePrimeIntellectJson(output, path)
  return output as Record<string, PrimeIntellectJson>
}

function validateMessage(value: unknown, path: string): void {
  const message = record(value, path)
  const role = message.role
  if (!['system', 'user', 'assistant', 'tool'].includes(String(role))) {
    throw new Error(`${path}.role is invalid`)
  }
  if (role === 'system' || role === 'user') {
    assertOnlyKeys(message, ['role', 'content'], path)
    validateContent(message.content, `${path}.content`)
  } else if (role === 'assistant') {
    assertOnlyKeys(
      message,
      ['role', 'content', 'reasoning_content', 'tool_calls', 'provider_state'],
      path,
    )
    optionalNullableString(message.content, `${path}.content`)
    optionalNullableString(message.reasoning_content, `${path}.reasoning_content`)
    if (message.tool_calls !== undefined) {
      validateToolCalls(message.tool_calls, `${path}.tool_calls`)
    }
    if (message.provider_state !== undefined) {
      validateProviderState(message.provider_state, `${path}.provider_state`)
    }
  } else {
    assertOnlyKeys(message, ['role', 'tool_call_id', 'content', 'name'], path)
    nonEmptyString(message.tool_call_id, `${path}.tool_call_id`)
    if (message.name !== undefined && typeof message.name !== 'string') {
      throw new Error(`${path}.name must be a string`)
    }
    validateContent(message.content, `${path}.content`)
  }
  validatePrimeIntellectJson(message, path)
}

function validateToolCalls(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  for (const [index, rawCall] of value.entries()) {
    const call = record(rawCall, `${path}[${index}]`)
    assertOnlyKeys(call, ['id', 'name', 'arguments'], `${path}[${index}]`)
    for (const field of ['id', 'name', 'arguments']) {
      nonEmptyString(call[field], `${path}[${index}].${field}`)
    }
  }
}

function validateProviderState(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  for (const [index, rawState] of value.entries()) {
    const state = record(rawState, `${path}[${index}]`)
    validatePrimeIntellectJson(state, `${path}[${index}]`)
  }
}

function validateContent(value: unknown, path: string): void {
  if (typeof value === 'string') return
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a string or non-empty content array`)
  }
  for (const [index, rawPart] of value.entries()) {
    const part = record(rawPart, `${path}[${index}]`)
    if (part.type === 'text' && typeof part.text === 'string') {
      assertOnlyKeys(part, ['type', 'text'], `${path}[${index}]`)
      continue
    }
    const image = part.image_url
    if (
      part.type === 'image_url' &&
      image !== null &&
      typeof image === 'object' &&
      !Array.isArray(image) &&
      typeof (image as Record<string, unknown>).url === 'string'
    ) {
      assertOnlyKeys(part, ['type', 'image_url'], `${path}[${index}]`)
      assertOnlyKeys(image as Record<string, unknown>, ['url'], `${path}[${index}].image_url`)
      continue
    }
    throw new Error(`${path}[${index}] is not a supported text or image_url content part`)
  }
}

function optionalNullableString(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new Error(`${path} must be a string or null`)
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${path}.${key} is not supported`)
  }
}
