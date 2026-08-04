import type { ExecutorConfig } from '../runtime/supervise/runtime'
import type {
  PrimeIntellectEpisodeContext,
  PrimeIntellectPublicTask,
  PrimeIntellectSplit,
} from './types'
import { validatePrimeIntellectJsonObject, validatePrimeIntellectPrompt } from './validation'

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
    task,
    model: {
      name: requiredEnv(env, ENV.model),
      baseUrl: requiredEnv(env, ENV.baseUrl),
      apiKey: requiredEnv(env, ENV.apiKey),
    },
    mcpServers,
  }
}

/** Resolve Prime's intercepted endpoint as transport-only Runtime executor configuration.
 * The caller's exact `AgentProfile` remains the sole owner of model and behavior. */
export function primeIntellectExecutorConfig(
  context: PrimeIntellectEpisodeContext,
): Extract<ExecutorConfig, { backend: 'router' }> {
  return Object.freeze({
    backend: 'router',
    routerBaseUrl: context.model.baseUrl,
    routerKey: context.model.apiKey,
  })
}

/**
 * Execute the caller's canonical runtime program inside a Prime rollout.
 * The callback may call runPersonified, runAgentic, runAgentRounds, or any product wrapper.
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
  for (const field of Object.keys(task)) {
    if (!['id', 'split', 'prompt', 'systemPrompt', 'metadata'].includes(field)) {
      throw new Error(`${ENV.task}.${field} is not supported`)
    }
  }
  const id = nonEmptyString(task.id, `${ENV.task}.id`)
  const split = validateSplit(task.split, `${ENV.task}.split`)
  const prompt = validatePrimeIntellectPrompt(task.prompt, `${ENV.task}.prompt`)
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
      : validatePrimeIntellectJsonObject(task.metadata, `${ENV.task}.metadata`)
  return {
    id,
    split,
    prompt,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
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
