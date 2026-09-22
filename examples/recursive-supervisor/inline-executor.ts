/**
 * Offline plumbing for recursive-supervisor: a scripted leaf `Executor`.
 *
 * It lives in this sibling so `recursive-supervisor.ts` leads with its LESSON (`scope.spawn` on a
 * conserved budget pool) instead of registry plumbing and casts.
 * A real leaf streams `UsageEvent`s as it burns budget and exposes its terminal artifact via
 * `resultArtifact()`; the scripted one derives its artifact from the task it was handed, with fixed
 * usage numbers. A production caller can provide any object implementing `Executor`.
 */

import type {
  Agent,
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '@tangle-network/agent-runtime/loops'

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
    profile: { name },
    harness: null,
    executor: scriptedExecutor(() => script),
  }
  return { name, act: async () => script.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}
