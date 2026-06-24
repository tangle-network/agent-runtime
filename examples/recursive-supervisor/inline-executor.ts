/**
 * The offline plumbing for recursive-supervisor — a scripted leaf `Executor` and the two ways
 * this example resolves children to one.
 *
 * It lives in this sibling so `recursive-supervisor.ts` leads with its LESSON (`scope.spawn` on a
 * conserved budget pool, then the `fanout` combinator) instead of registry plumbing and as-casts.
 * A real leaf streams `UsageEvent`s as it burns budget and exposes its terminal artifact via
 * `resultArtifact()`; the scripted one derives its artifact from the task it was handed, with fixed
 * usage numbers. Swap any of this for `createExecutor({ backend })` (router / router-tools /
 * sandbox / cli) or any object implementing `Executor`.
 */

import type {
  Agent,
  AgentProfile,
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '@tangle-network/agent-runtime/loops'
import { createExecutorRegistry } from '@tangle-network/agent-runtime/loops'

export interface Script {
  out: string
  score: number
  tokens: { input: number; output: number }
}

export function scriptedExecutor(scriptFor: (task: unknown) => Script): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      const script = scriptFor(task)
      return (async function* () {
        const verdict: DefaultVerdict = { valid: true, score: script.score }
        artifact = {
          outRef: `mock:${script.out}`,
          out: script.out,
          verdict,
          spent: { iterations: 1, tokens: script.tokens, usd: 0, ms: 0 },
        }
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: script.tokens.input, output: script.tokens.output }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new Error('mock executor: resultArtifact before stream drained')
      return artifact
    },
  }
}

/** A leaf agent carrying its executor as the BYO `executorSpec.executor` —
 *  the default registry resolves it verbatim, so no built-in runtime fires. */
export function leaf(name: string, script: Script): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: scriptedExecutor(() => script),
  }
  return { name, act: async () => script.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** The Part-2 registry: mints a fresh scripted leaf per spawn, scored by the angle index the
 *  fanout combinator put on the child task. `definePersona` binds it as the persona's resolver.
 *  Returned with its structural type inferred — the persona's `executors.registry` field accepts
 *  any object with this `register` + `resolve` shape. */
export function scriptedPersonaRegistry() {
  const base = createExecutorRegistry()
  return {
    register: base.register.bind(base),
    resolve<Out>(_spec: AgentSpec) {
      return {
        succeeded: true as const,
        value: (): Executor<Out> =>
          scriptedExecutor((task) => {
            const index =
              task && typeof task === 'object' && 'index' in task
                ? Number((task as { index: unknown }).index)
                : 0
            return {
              out: `thesis-${index}`,
              score: 0.3 + index * 0.3,
              tokens: { input: 20, output: 20 },
            }
          }) as Executor<Out>,
      }
    },
  }
}
