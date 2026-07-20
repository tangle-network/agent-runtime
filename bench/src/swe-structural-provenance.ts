import { createHash } from 'node:crypto'

export const FINGERPRINT_SCHEMA = 'swe-structural-v2' as const

export interface Fingerprints {
  schema: typeof FINGERPRINT_SCHEMA
  source: string
  config: string
  commonConfig: string
  repro: string
  prompt: string
  tools: string
  task: string
  composite: string
}

export interface FingerprintInputs {
  source: unknown
  config: unknown
  commonConfig: unknown
  repro: unknown
  prompt: unknown
  tools: unknown
  task: unknown
}

export interface SharedExecutionReceipt {
  runTool: {
    timeoutS: number
    outputLimit: number
  }
  runtimeImplementationFingerprint: string
  runtimeTreeFingerprint: string
  officialScorer: {
    package: 'swebench'
    version: string
    cacheLevel: 'instance'
    namespacePolicy: 'phase-a-image'
  }
}

export interface ExecutionReceipt extends SharedExecutionReceipt {
  image: {
    tag: string
    namespace: 'swebench' | 'none'
    id: string
    repoDigests: string[]
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function createFingerprints(inputs: FingerprintInputs): Fingerprints {
  const parts = {
    schema: FINGERPRINT_SCHEMA,
    source: fingerprint(inputs.source),
    config: fingerprint(inputs.config),
    commonConfig: fingerprint(inputs.commonConfig),
    repro: fingerprint(inputs.repro),
    prompt: fingerprint(inputs.prompt),
    tools: fingerprint(inputs.tools),
    task: fingerprint(inputs.task),
  }
  return { ...parts, composite: fingerprint(parts) }
}

export function assertFingerprintsEqual(
  actual: Fingerprints | undefined,
  expected: Fingerprints,
  context: string,
): void {
  if (!actual) throw new Error(`${context}: missing ${FINGERPRINT_SCHEMA} fingerprints`)
  for (const key of Object.keys(expected) as Array<keyof Fingerprints>) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${context}: ${key} fingerprint mismatch (${actual[key]} != ${expected[key]})`)
    }
  }
}

export function diffFingerprint(diff: string): string {
  return fingerprint({ diff })
}

export function diffChanged(parent: string, candidate: string): boolean {
  return diffFingerprint(parent) !== diffFingerprint(candidate)
}

/** Hash the actual imported callables, not merely the source file expected to contain them. */
export function runtimeImplementationFingerprint(input: {
  runAgentic: unknown
  refine: { name: string; driver: unknown }
}): string {
  if (typeof input.runAgentic !== 'function' || typeof input.refine.driver !== 'function') {
    throw new Error('runtime implementation receipt requires callable runAgentic and refine.driver')
  }
  return fingerprint({
    runAgentic: Function.prototype.toString.call(input.runAgentic),
    refine: {
      name: input.refine.name,
      driver: Function.prototype.toString.call(input.refine.driver),
    },
  })
}

export function createExecutionReceipt(
  shared: SharedExecutionReceipt,
  image: { tag: string; namespace: 'swebench' | 'none'; identity: { id: string; repoDigests: string[] } },
): ExecutionReceipt {
  return {
    ...shared,
    runTool: { ...shared.runTool },
    officialScorer: { ...shared.officialScorer },
    image: {
      tag: image.tag,
      namespace: image.namespace,
      id: image.identity.id,
      repoDigests: [...image.identity.repoDigests],
    },
  }
}
