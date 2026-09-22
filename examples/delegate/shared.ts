import type {
  DeliverableSpec,
  EnvironmentWorkerOptions,
  EnvironmentWorkerResult,
} from '@tangle-network/agent-runtime/loops'
import { localEnvironmentProvider } from '@tangle-network/agent-runtime/loops'

export function makeWorkerEnvironment(args: {
  routerBaseUrl: string
  routerKey: string
  model: string
}): EnvironmentWorkerOptions {
  return {
    provider: localEnvironmentProvider({
      router: { baseUrl: args.routerBaseUrl, key: args.routerKey, model: args.model },
    }),
  }
}

export function exactText(expected: string): DeliverableSpec<EnvironmentWorkerResult> {
  return {
    check: (out) => out.content.trim() === expected,
    describe: `worker output is exactly ${JSON.stringify(expected)}`,
  }
}
