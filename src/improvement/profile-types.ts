import type { AgentProfile } from '@tangle-network/agent-interface'

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T

/** Complete immutable profile value used during measured execution. */
export type ReadonlyAgentProfile = DeepReadonly<AgentProfile>
