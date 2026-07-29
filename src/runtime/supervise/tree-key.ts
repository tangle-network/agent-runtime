import type { NodeId } from './types'

/** Runtime tag used only for a child that owns another supervised scope. */
export const driverRuntime = 'driver' as const

// Recursive ownership is an executor capability, not a Runtime string. `Runtime` is deliberately
// open, so a caller-owned leaf may also call itself "driver". Keep the capability on the exact
// Runtime-created executor object and never expose a public lookalike property that a leaf can set.
const nestedDriverTreeOwners = new WeakSet<object>()

/** Canonical journal key for the scope owned by one nested driver node. */
export function nestedDriverTreeRoot(parentTreeRoot: NodeId, driverNodeId: NodeId): NodeId {
  return `${parentTreeRoot}/${driverNodeId}`
}

/** Privately mark the exact recursive executor that will create a nested journal tree. */
export function attestNestedDriverTreeOwner<T extends object>(owner: T): T {
  nestedDriverTreeOwners.add(owner)
  return owner
}

/** Return the canonical owned tree only for an exact privately marked recursive executor. */
export function runtimeOwnedNestedDriverTreeRoot(
  owner: object,
  parentTreeRoot: NodeId,
  driverNodeId: NodeId,
): NodeId | undefined {
  return nestedDriverTreeOwners.has(owner)
    ? nestedDriverTreeRoot(parentTreeRoot, driverNodeId)
    : undefined
}
