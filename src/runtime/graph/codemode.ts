/**
 * `codemode` — a node whose action space is CODE, not JSON tool calls.
 *
 * An `agent` node acts by emitting one tool call per turn: N steps cost N model round trips, and
 * every tool's schema occupies context. A `codemode` node asks the model once for a small program
 * written against a typed API of exactly the operations this node grants, then runs it. Loops,
 * branches and fan-out happen inside one turn, and intermediate values live in the program's
 * memory instead of the transcript.
 *
 * THE THREE THINGS THIS OWNS, and why a prompt cannot:
 *
 *  1. THE API IS PROJECTED FROM THE GRANT, not described in prose. `operations` is the whole
 *     surface: what the model is told it may call is generated from the same table the runner
 *     binds, so a documented-but-ungranted call cannot exist, and a granted-but-undocumented one
 *     cannot hide.
 *  2. THE EXECUTION BOUNDARY IS THE HOST'S. This kind declares a `codeRunner` effect and runs
 *     nothing itself. A host that wants speed supplies an in-process runner; a host that wants
 *     isolation supplies a jailed one. The kind is identical either way, so the choice is
 *     configuration and not a rewrite — and no default silently picks the unsafe one.
 *  3. ACCOUNTING PASSES THROUGH THE KERNEL. The node is an ordinary `Executor` under
 *     `Scope.spawn`, so its reservation, settlement, journal record and completion gate are the
 *     kernel's, exactly like every other node. An operation that spends reports its spend, and the
 *     node totals it. This is the property `strategy-author.ts` gets by construction (its authored
 *     bodies compose `shot()`/`critique()`, which spend through the pool) and the reason code mode
 *     cannot be bolted on as a prompt: code that calls tools OUTSIDE the seams makes the budget
 *     and the journal lie.
 *
 * SAFETY, stated plainly: {@link assertAuthoredCode} is a LINT, not a sandbox. It refuses the
 * obvious escapes in authored source; it cannot stop determined code running in-process. Treat the
 * in-process runner as a development convenience and give a `codeRunner` that jails when the code
 * is not yours.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { Agent, AgentSpec, Executor, ExecutorResult, Spend } from '../supervise/types'
import type { NodeKind } from './kind'

/** One operation the authored program may call, and the line the model is shown about it. */
export interface CodeOperation {
  /** Identifier the program calls, e.g. `search`. Must be a valid JS identifier. */
  readonly name: string
  /** The signature and meaning, as the model sees it: `search(query: string): Promise<Hit[]>`. */
  readonly signature: string
  readonly description: string
  /** What the call actually does. A spend it reports is added to the node's settlement. */
  readonly call: (
    ...args: ReadonlyArray<unknown>
  ) => Promise<CodeOperationResult> | CodeOperationResult
}

/** An operation's answer. `spend` is optional; an operation that costs nothing omits it. */
export interface CodeOperationResult {
  readonly value: unknown
  readonly spend?: Spend
}

/** What a host's `codeRunner` effect must do: run authored source with `api` in scope, and answer
 *  what it returned. The host decides WHERE that happens — in process, or jailed. */
export interface CodeRunner {
  run(args: {
    readonly code: string
    readonly api: Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>
    readonly signal: AbortSignal
  }): Promise<unknown>
}

/** What a host's `model` effect must do: answer one prompt with text. */
export interface CodeAuthor {
  complete(args: {
    readonly prompt: string
    readonly profile: AgentProfile
    readonly signal: AbortSignal
  }): Promise<{ readonly text: string; readonly spend?: Spend }>
}

export interface CodeModeConfig {
  readonly operations: ReadonlyArray<CodeOperation>
  /** What the program must accomplish, in the author's words. Appended to the generated API doc. */
  readonly task: string
  /** Import specifiers the authored code may name. Empty (the default) bans every import. */
  readonly allowedImports?: ReadonlyArray<string>
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

/**
 * Refuse the obvious escapes in authored source. A LINT, not a sandbox: it reads text and cannot
 * constrain what running code does. Generalized from `strategy-author.ts`'s contract check, which
 * has guarded agent-authored optimization strategies since 0.60.
 */
export function assertAuthoredCode(
  code: string,
  options: { readonly allowedImports?: ReadonlyArray<string>; readonly context?: string } = {},
): void {
  const context = options.context ?? 'authored code'
  const allowed = options.allowedImports ?? []
  for (const line of code.split('\n')) {
    if (!/^\s*import\s/.test(line)) continue
    const named = allowed.some(
      (specifier) => line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`),
    )
    if (!named) {
      throw new ValidationError(
        `${context} rejected: foreign import — ${line.trim().slice(0, 120)}${
          allowed.length === 0
            ? ' (no import is allowed here)'
            : ` (allowed: ${allowed.join(', ')})`
        }`,
      )
    }
  }
  const banned: ReadonlyArray<readonly [RegExp, string]> = [
    [/\brequire\s*\(/, 'require()'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\beval\s*\(/, 'eval()'],
    [/new\s+Function\s*\(/, 'new Function()'],
    [/\bprocess\s*[.[]/, 'process access'],
    [/\bglobalThis\s*[.[]/, 'globalThis access'],
    [/\bfetch\s*\(/, 'network access'],
    [/child_process|node:fs|node:net|node:http|worker_threads/, 'node builtin access'],
  ]
  for (const [pattern, what] of banned) {
    if (pattern.test(code)) throw new ValidationError(`${context} rejected: ${what}`)
  }
}

/** The API doc the model is shown — generated from the grant, so the two cannot disagree. */
export function renderCodeApi(config: CodeModeConfig): string {
  const lines = config.operations.map(
    (operation) => `  ${operation.signature}\n    // ${operation.description}`,
  )
  return [
    'Write ONE async function body. It may call only these operations:',
    '',
    ...lines,
    '',
    "Return the result as the body's return value. No imports, no require, no process, no fetch.",
    'Reply with a single fenced code block and nothing else.',
    '',
    `TASK: ${config.task}`,
  ].join('\n')
}

/** Pull the first fenced block out of a model reply; the whole reply if it carries no fence. */
export function extractCodeBlock(reply: string): string {
  const fenced = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/u.exec(reply)
  const code = (fenced?.[1] ?? reply).trim()
  if (code.length === 0) throw new ValidationError('codemode: the model returned no code')
  return code
}

/**
 * A node that asks a model for a program and runs it. Declares the two effects it cannot supply
 * itself — `model` (who writes the code) and `codeRunner` (where it runs) — so the host owns both.
 */
export function codemodeKind(): NodeKind<CodeModeConfig, readonly ['model', 'codeRunner']> {
  return {
    id: 'codemode',
    version: 1,
    description: 'Ask a model for a program over a granted API, then run it as one node.',
    validateConfig: (raw, context) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ValidationError(`${context}: codemode config must be an object`)
      }
      const config = raw as Partial<CodeModeConfig>
      if (typeof config.task !== 'string' || config.task.trim().length === 0) {
        throw new ValidationError(`${context}: codemode config.task must be a non-empty string`)
      }
      if (!Array.isArray(config.operations) || config.operations.length === 0) {
        throw new ValidationError(
          `${context}: codemode config.operations must grant at least one operation`,
        )
      }
      const seen = new Set<string>()
      for (const operation of config.operations) {
        if (!IDENTIFIER.test(operation?.name ?? '')) {
          throw new ValidationError(
            `${context}: operation name ${JSON.stringify(operation?.name)} is not a JS identifier`,
          )
        }
        if (seen.has(operation.name)) {
          throw new ValidationError(`${context}: duplicate operation ${operation.name}`)
        }
        seen.add(operation.name)
        if (typeof operation.call !== 'function') {
          throw new ValidationError(`${context}: operation ${operation.name} has no call`)
        }
      }
      return {
        operations: config.operations,
        task: config.task,
        ...(config.allowedImports === undefined ? {} : { allowedImports: config.allowedImports }),
      }
    },
    configSchema: {
      type: 'object',
      properties: { task: { type: 'string' }, operations: { type: 'array' } },
      required: ['task', 'operations'],
    },
    inputs: [{ name: 'context', schema: {} }],
    // `out` and `trace` are implicit on every node; declaring them is refused by the contract.
    outputs: [],
    effects: ['model', 'codeRunner'] as const,
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile, inputs, effects }) => {
      const author = effects.model as CodeAuthor
      const runner = effects.codeRunner as CodeRunner
      let artifact: ExecutorResult<unknown> | undefined
      const executor: Executor<unknown> = {
        runtime: 'inline',
        async execute(task, signal): Promise<ExecutorResult<unknown>> {
          const spends: Spend[] = []
          const prompt = [
            renderCodeApi(config),
            inputs.context === undefined ? '' : `\nCONTEXT: ${JSON.stringify(inputs.context)}`,
            typeof task === 'string' && task.length > 0 ? `\n${task}` : '',
          ]
            .filter((part) => part.length > 0)
            .join('\n')
          const authored = await author.complete({ prompt, profile, signal })
          if (authored.spend) spends.push(authored.spend)
          const code = extractCodeBlock(authored.text)
          // Refuse before running, so a rejected program costs the model call and nothing else.
          assertAuthoredCode(code, {
            ...(config.allowedImports === undefined
              ? {}
              : { allowedImports: config.allowedImports }),
            context: `codemode ${JSON.stringify(profile.name ?? 'node')}`,
          })
          // Bind the grant: exactly the operations declared, each one metering itself.
          const api: Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>> = {}
          for (const operation of config.operations) {
            api[operation.name] = async (...args) => {
              const result = await operation.call(...args)
              if (result?.spend) spends.push(result.spend)
              return result?.value
            }
          }
          const out = await runner.run({ code, api: Object.freeze(api), signal })
          artifact = { outRef: contentAddress({ codemode: out }), out, spent: totalSpend(spends) }
          return artifact
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact: () => {
          if (!artifact)
            throw new ValidationError('codemode: resultArtifact() read before execute()')
          return artifact
        },
      }
      return {
        name: profile.name ?? 'codemode',
        act: () => Promise.reject(new ValidationError('codemode: act() is not the execution path')),
        executorSpec: { profile, harness: null, executor } as AgentSpec,
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    },
  }
}

/** The node's spend is the model call plus every operation that reported one. An operation that
 *  reports nothing is not assumed free — it contributes an UNKNOWN mark, like the kernel's own. */
function totalSpend(parts: ReadonlyArray<Spend>): Spend {
  const zero: Spend = { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  return parts.reduce<Spend>(
    (total, part) => ({
      iterations: total.iterations + (part.iterations ?? 0),
      tokens: {
        input: total.tokens.input + (part.tokens?.input ?? 0),
        output: total.tokens.output + (part.tokens?.output ?? 0),
        ...(part.tokens?.tokensKnown === false ? { tokensKnown: false } : {}),
      },
      usd: total.usd + (part.usd ?? 0),
      ...(part.usdKnown === false ? { usdKnown: false } : {}),
      ms: total.ms + (part.ms ?? 0),
    }),
    zero,
  )
}

/**
 * An in-process `codeRunner`: builds the authored body as a function with the granted API in
 * scope. **A development convenience, not a security boundary** — `assertAuthoredCode` is a lint,
 * and code running in this process can reach whatever the process can. Supply a jailed runner for
 * code you did not write.
 */
export function inlineCodeRunner(): CodeRunner {
  return {
    async run({ code, api }) {
      const names = Object.keys(api)
      const build = new Function(...names, `"use strict"; return (async () => { ${code} })()`)
      return build(...names.map((name) => api[name]))
    },
  }
}
