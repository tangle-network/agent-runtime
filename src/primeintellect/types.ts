export type PrimeIntellectSplit = 'train' | 'eval'

export type PrimeIntellectJson =
  | null
  | boolean
  | number
  | string
  | PrimeIntellectJson[]
  | { [key: string]: PrimeIntellectJson }

export type PrimeIntellectContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export type PrimeIntellectMessage =
  | { role: 'system' | 'user'; content: PrimeIntellectContent }
  | {
      role: 'assistant'
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{ id: string; name: string; arguments: string }>
      provider_state?: Array<Record<string, PrimeIntellectJson>>
    }
  | {
      role: 'tool'
      tool_call_id: string
      content: PrimeIntellectContent
      name?: string
    }

/** One immutable problem. References stay inside Prime's task process. */
export interface PrimeIntellectTask {
  id: string
  split: PrimeIntellectSplit
  prompt: string | PrimeIntellectMessage[]
  systemPrompt?: string
  answer?: string | string[]
  metadata?: Record<string, PrimeIntellectJson>
}

export type PrimeIntellectScoring =
  | {
      kind: 'exact'
      normalization?: 'none' | 'trim' | 'trim-casefold'
    }
  | {
      kind: 'reference-judge'
      model: string
      prompt?: string
      view?: 'last_reply' | 'full_trace'
    }
  | {
      kind: 'command'
      command: readonly [string, ...string[]]
      files?: Readonly<Record<string, string>>
      forwardEnv?: readonly string[]
      timeoutSeconds?: number
    }

export type PrimeIntellectSetupCommand = readonly [string, ...string[]]

/** Files and commands that make the caller's real agent program runnable. */
export interface PrimeIntellectRunner {
  command: readonly [string, ...string[]]
  files?: Readonly<Record<string, string>>
  setup?: readonly PrimeIntellectSetupCommand[]
  forwardEnv?: readonly string[]
  /** Container image used by the generated eval config. */
  image: string
}

export interface PrimeIntellectPackageOptions {
  name: string
  version: string
  description?: string
  tasks: readonly PrimeIntellectTask[]
  scoring: PrimeIntellectScoring
  runner: PrimeIntellectRunner
  /** Prime-enforced model turn cap. Default 16. */
  maxTurns?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxTotalTokens?: number
  rolloutTimeoutSeconds?: number
  scoringTimeoutSeconds?: number
}

export interface PrimeIntellectPackageManifest {
  schema: 'tangle.primeintellect.package/v1'
  name: string
  moduleName: string
  version: string
  verifiers: '>=0.2.0,<0.3.0'
  taskCount: number
  splits: Record<PrimeIntellectSplit, number>
  taskIdsSha256: string
  filesSha256: Record<string, string>
}

export interface PrimeIntellectPackageBundle {
  manifest: PrimeIntellectPackageManifest
  /** Relative package path to UTF-8 contents. */
  files: Readonly<Record<string, string>>
}

/** The answer-free task exposed to the caller's runtime program. */
export interface PrimeIntellectPublicTask {
  id: string
  split: PrimeIntellectSplit
  prompt: string | PrimeIntellectMessage[]
  systemPrompt?: string
  metadata?: Record<string, PrimeIntellectJson>
}

export interface PrimeIntellectEpisodeContext {
  protocol: 'tangle.primeintellect.episode/v1'
  task: PrimeIntellectPublicTask
  model: {
    name: string
    baseUrl: string
    apiKey: string
  }
  mcpServers: Readonly<Record<string, string>>
}
