/**
 * `codemode` — a graph node whose action space is CODE, not JSON tool calls.
 *
 * WHERE THIS SITS IN THE TERM'S MAINSTREAM MEANING, so the name is not misread. "Code mode" as
 * the ecosystem uses it (Cloudflare's Code Mode, Anthropic's "code execution with MCP") is a
 * TOOLS-PRESENTATION change for an agent that ALREADY executes code: project the granted tools as
 * a typed code API, let the agent write programs against it, keep intermediates out of the
 * context window. For a HARNESS agent (claude-code/codex in a sandbox) that capability is native
 * — the integration is knowledge, and it ships as `skills/codemode/SKILL.md`, not as this node.
 *
 * THIS KIND IS THE OTHER ARM — CodeAct (Wang et al., ICML 2024; smolagents' CodeAgent): a
 * ROUTER-BRAINED model with no execution environment of its own authors one program against the
 * operations this node grants, and the runtime executes it. It is router-only BY CONSTRUCTION:
 * the `model` effect is a one-shot `complete()`, which a harness brain cannot drive. One model
 * turn replaces one round trip per step, and intermediates live in program memory.
 *
 * WHAT IS GENUINELY THIS NODE'S, beyond what `extraTools`/`authorStrategy` already offered a
 * router model:
 *
 *  1. THE API IS PROJECTED FROM THE GRANT, not described in prose. `operations` is the whole
 *     surface: what the model is told it may call is generated from the same table the runner
 *     binds, so a documented-but-ungranted call cannot exist, and a granted-but-undocumented one
 *     cannot hide.
 *  2. THE EXECUTION BOUNDARY IS THE HOST'S. This kind declares a `codeRunner` effect and runs
 *     nothing itself; in-process or jailed is the host's configuration, and the engine refuses
 *     before spending when no runner was supplied.
 *  3. PER-OPERATION SPEND REACHES THE KERNEL. Every existing tool-execute seam returns a bare
 *     string, so an operation that costs money could not settle true spend; here each operation
 *     reports its spend and the node totals it into the settlement the kernel journals. This is
 *     the property that keeps authored code from spending outside the budget — the same reason
 *     `authorStrategy`'s bodies compose `shot()`/`critique()` through the pool.
 *
 * SAFETY, stated plainly: {@link assertAuthoredCode} is a LINT, not a sandbox. Treat the
 * in-process runner as a development convenience and give a `codeRunner` that jails when the
 * code is not yours.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import { assertAuthoredCode, extractCodeBlock } from '../authored-code'

export { type AuthoredCodeOptions, assertAuthoredCode, extractCodeBlock } from '../authored-code'

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
