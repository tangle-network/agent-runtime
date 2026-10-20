import { ValidationError } from '../../errors'
import { cliExecutor } from './cli-process-executor'
import { executableAgentSpecSnapshot } from './executable-spec'
import { routerInlineExecutor } from './router-inline-executor'
import { sandboxExecutor } from './sandbox-leaf-executor'
import type { AgentSpec, Executor, ExecutorFactory, ExecutorRegistry, Runtime } from './types'

/**
 * The open resolver/registry. Pre-registers the three built-ins under their
 * runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
 * factory)` for any additional runtime. A BYO `AgentSpec.executor` has highest routing precedence
 * after the same exact-profile intake validation. Registration + BYO remain open extension points.
 *
 * `resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executorFactory` →
 * `spec.executor` → `harness === null` → the `'router'` factory; else a registered factory for the
 * harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.
 */
export function createExecutorRegistry(): ExecutorRegistry {
  const factories = new Map<Runtime, ExecutorFactory<unknown>>()
  factories.set('router', routerInlineExecutor)
  factories.set('inline', routerInlineExecutor)
  factories.set('sandbox', sandboxExecutor)
  factories.set('cli', cliExecutor)

  return {
    register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void {
      if (factories.has(runtime)) {
        throw new ValidationError(`executor registry: runtime "${runtime}" already registered`)
      }
      factories.set(runtime, factory as ExecutorFactory<unknown>)
    },
    resolve<Out>(
      rawSpec: AgentSpec,
    ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string } {
      const spec = executableAgentSpecSnapshot(rawSpec, 'executor registry')
      const bind =
        (factory: ExecutorFactory<Out>): ExecutorFactory<Out> =>
        (_ignored, context) =>
          factory(spec, context)
      // BYO factory: constructed only after Scope admission with the real signal/context.
      if (spec.executorFactory) {
        return {
          succeeded: true,
          value: bind(spec.executorFactory as ExecutorFactory<Out>),
        }
      }
      // BYO: a caller-supplied executor wins, wrapped in a trivial per-spawn factory.
      if (spec.executor) {
        const byo = spec.executor
        return { succeeded: true, value: bind(() => byo as Executor<Out>) }
      }
      // router/inline: an agent with no harness is a direct Router call.
      if (spec.harness === null) {
        const f = factories.get('router')
        if (!f) return { succeeded: false, error: 'executor registry: no "router" factory' }
        return { succeeded: true, value: bind(f as ExecutorFactory<Out>) }
      }
      // sandbox: any BackendType maps to the sandbox-composing-runAgentRounds executor.
      const runtimeTag: Runtime = 'sandbox'
      const f = factories.get(runtimeTag)
      if (!f) {
        return {
          succeeded: false,
          error: `executor registry: no factory for runtime "${runtimeTag}" (harness "${spec.harness}") and no BYO executor`,
        }
      }
      return { succeeded: true, value: bind(f as ExecutorFactory<Out>) }
    },
  }
}
