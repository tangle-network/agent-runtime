import { createOpenAICompatibleBackend } from '../backends'
import type {
  PrimeIntellectEpisodeContext,
  PrimeIntellectJson,
  PrimeIntellectMessage,
  PrimeIntellectPublicTask,
  PrimeIntellectSplit,
} from './types'

const ENV = {
  task: 'TANGLE_PRIME_TASK_JSON',
  model: 'OPENAI_MODEL',
  baseUrl: 'OPENAI_BASE_URL',
  apiKey: 'OPENAI_API_KEY',
  mcpServers: 'TANGLE_PRIME_MCP_SERVERS_JSON',
} as const

export interface RunPrimeIntellectProgramOptions {
  env?: NodeJS.ProcessEnv
}

export type PrimeIntellectBackendOptions = Omit<
  Parameters<typeof createOpenAICompatibleBackend>[0],
  'apiKey' | 'baseUrl' | 'model'
>

/** Read and validate the private process contract installed by the generated Prime harness. */
export function readPrimeIntellectEpisodeContext(
  env: NodeJS.ProcessEnv = process.env,
): PrimeIntellectEpisodeContext {
  const rawTask = requiredEnv(env, ENV.task)
  const rawMcp = env[ENV.mcpServers] ?? '{}'
  const parsedTask = parseJson(rawTask, ENV.task)
  const parsedMcp = parseJson(rawMcp, ENV.mcpServers)
  const task = validatePublicTask(parsedTask)
  const mcpServers = validateStringMap(parsedMcp, ENV.mcpServers)

  return {
    protocol: 'tangle.primeintellect.episode/v1',
    task,
    model: {
      name: requiredEnv(env, ENV.model),
      baseUrl: requiredEnv(env, ENV.baseUrl),
      apiKey: requiredEnv(env, ENV.apiKey),
    },
    mcpServers,
  }
}

/** Build the existing runtime backend against Prime's intercepted model endpoint. */
export function createPrimeIntellectBackend(
  context: PrimeIntellectEpisodeContext,
  options: PrimeIntellectBackendOptions = {},
) {
  return createOpenAICompatibleBackend({
    ...options,
    apiKey: context.model.apiKey,
    baseUrl: context.model.baseUrl,
    model: context.model.name,
    kind: options.kind ?? 'primeintellect',
  })
}

/**
 * Execute the caller's canonical runtime program inside a Prime rollout.
 * The callback may call runPersonified, runAgentic, runLoop, or any product wrapper.
 */
export async function runPrimeIntellectProgram<Result>(
  run: (context: PrimeIntellectEpisodeContext) => Promise<Result>,
  options: RunPrimeIntellectProgramOptions = {},
): Promise<Result> {
  return run(readPrimeIntellectEpisodeContext(options.env))
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`PrimeIntellect runner requires ${name}`)
  }
  return value
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${name} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validatePublicTask(value: unknown): PrimeIntellectPublicTask {
  const task = record(value, ENV.task)
  for (const privateField of ['answer', 'reference', 'scoring', 'score']) {
    if (privateField in task) {
      throw new Error(`${ENV.task} exposed private field ${privateField}`)
    }
  }
  const id = nonEmptyString(task.id, `${ENV.task}.id`)
  const split = validateSplit(task.split, `${ENV.task}.split`)
  const prompt = validatePrompt(task.prompt, `${ENV.task}.prompt`)
  const systemPrompt = optionalString(task.systemPrompt, `${ENV.task}.systemPrompt`)
  if (
    systemPrompt !== undefined &&
    Array.isArray(prompt) &&
    prompt.some((message) => message.role === 'system')
  ) {
    throw new Error(`${ENV.task} must not set systemPrompt and include a system message`)
  }
  const metadata =
    task.metadata === undefined
      ? undefined
      : (validateJsonObject(task.metadata, `${ENV.task}.metadata`) as Record<
          string,
          PrimeIntellectJson
        >)
  return {
    id,
    split,
    prompt,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

function validatePrompt(value: unknown, path: string): string | PrimeIntellectMessage[] {
  if (typeof value === 'string' && value.length > 0) return value
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty string or message array`)
  }
  for (const [index, message] of value.entries()) {
    const item = record(message, `${path}[${index}]`)
    const role = item.role
    if (!['system', 'user', 'assistant', 'tool'].includes(String(role))) {
      throw new Error(`${path}[${index}].role is invalid`)
    }
    if (role === 'system' || role === 'user') {
      assertOnlyKeys(item, ['role', 'content'], `${path}[${index}]`)
      validateContent(item.content, `${path}[${index}].content`)
    } else if (role === 'assistant') {
      assertOnlyKeys(
        item,
        ['role', 'content', 'reasoning_content', 'tool_calls', 'provider_state'],
        `${path}[${index}]`,
      )
      if (item.content !== undefined && item.content !== null && typeof item.content !== 'string') {
        throw new Error(`${path}[${index}].content must be a string or null`)
      }
      if (
        item.reasoning_content !== undefined &&
        item.reasoning_content !== null &&
        typeof item.reasoning_content !== 'string'
      ) {
        throw new Error(`${path}[${index}].reasoning_content must be a string or null`)
      }
      if (item.tool_calls !== undefined) {
        validateToolCalls(item.tool_calls, `${path}[${index}].tool_calls`)
      }
      if (item.provider_state !== undefined) {
        validateProviderState(item.provider_state, `${path}[${index}].provider_state`)
      }
    } else {
      assertOnlyKeys(item, ['role', 'tool_call_id', 'content', 'name'], `${path}[${index}]`)
      nonEmptyString(item.tool_call_id, `${path}[${index}].tool_call_id`)
      if (item.name !== undefined && typeof item.name !== 'string') {
        throw new Error(`${path}[${index}].name must be a string`)
      }
      validateContent(item.content, `${path}[${index}].content`)
    }
    validateJson(item, `${path}[${index}]`)
  }
  return value as PrimeIntellectMessage[]
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
    validateJson(state, `${path}[${index}]`)
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
    if (
      part.type === 'image_url' &&
      part.image_url !== null &&
      typeof part.image_url === 'object' &&
      !Array.isArray(part.image_url) &&
      typeof (part.image_url as Record<string, unknown>).url === 'string'
    ) {
      assertOnlyKeys(part, ['type', 'image_url'], `${path}[${index}]`)
      assertOnlyKeys(
        part.image_url as Record<string, unknown>,
        ['url'],
        `${path}[${index}].image_url`,
      )
      continue
    }
    throw new Error(`${path}[${index}] is not a supported text or image_url content part`)
  }
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

function validateSplit(value: unknown, path: string): PrimeIntellectSplit {
  if (value !== 'train' && value !== 'eval') {
    throw new Error(`${path} must be train or eval`)
  }
  return value
}

function validateStringMap(value: unknown, path: string): Readonly<Record<string, string>> {
  const input = record(value, path)
  const output: Record<string, string> = {}
  for (const [key, entry] of Object.entries(input)) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`${path}.${key} must be a non-empty string`)
    }
    output[key] = entry
  }
  return output
}

function validateJsonObject(value: unknown, path: string): Record<string, PrimeIntellectJson> {
  const output = record(value, path)
  validateJson(output, path)
  return output as Record<string, PrimeIntellectJson>
}

function validateJson(value: unknown, path: string): void {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateJson(entry, `${path}[${index}]`)
    })
    return
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) validateJson(entry, `${path}.${key}`)
    return
  }
  throw new Error(`${path} is not JSON serializable`)
}

function record(value: unknown, path: string): Record<string, unknown> {
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

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}
