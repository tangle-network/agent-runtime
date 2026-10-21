/**
 * The nodes of a strategy search: the caller's root or an authored module, how the ledger
 * stores them, how a node becomes a runnable `Strategy`, and the names the report gives them.
 */

import {
  type SearchArtifactCodec,
  type SearchRecorder,
  type SearchStateView,
  surfaceDiff,
} from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest, sha256Bytes } from '../candidate-execution/digest'
import { loadAuthoredStrategy, type Strategy } from './strategy-author'

/** A search node: the caller's root, or an authored module and why admission refused it. */
export type StrategyNode =
  | { kind: 'root'; name: string }
  | { kind: 'authored'; name: string | null; code: string; refusal: string | null }

/** How the ledger stores a node's artifact and reads it back. */
export function strategyNodeCodec(root: Strategy): SearchArtifactCodec<StrategyNode> {
  const rootNode: StrategyNode = { kind: 'root', name: root.name }
  return {
    node(rec, node) {
      const artifact = rec.blob('strategy', { ...node })
      return {
        artifactDigest:
          node.kind === 'root'
            ? canonicalCandidateDigest({ kind: 'root', name: node.name })
            : sha256Bytes(Buffer.from(node.code, 'utf8')),
        artifact,
        surfaces: [{ surfaceId: 'strategy', kind: 'code', artifact }],
      }
    },
    diff(rec, parent, child) {
      if (parent.kind === 'root' || child.kind === 'root') {
        return { unknown: 'the root is a caller-supplied strategy with no source here' }
      }
      return surfaceDiff(rec, parent.code, child.code)
    },
    load(rec, node) {
      const stored = rec.readBlob(node.artifact) as StrategyNode
      if (stored.kind === 'root') {
        if (stored.name !== root.name) {
          throw new Error(
            `evolution: node ${node.nodeId} is root '${stored.name}', not '${root.name}'`,
          )
        }
        return rootNode
      }
      if (stored.kind === 'authored' && typeof stored.code === 'string') return stored
      throw new Error(`evolution: node ${node.nodeId} holds no strategy`)
    },
  }
}

/** Resolve a node to its runnable strategy; an authored module loads once per source. */
export function strategyLoader(
  root: Strategy,
  modulesDir: string,
): (node: StrategyNode) => Promise<Strategy> {
  const loaded = new Map<string, Promise<Strategy>>()
  return (node) => {
    if (node.kind === 'root') return Promise.resolve(root)
    let strategy = loaded.get(node.code)
    if (!strategy) {
      strategy = loadAuthoredStrategy(node.code, modulesDir).then((module) => module.strategy)
      loaded.set(node.code, strategy)
    }
    return strategy
  }
}

/** Report names: each node's strategy name, suffixed `~<ordinal>` when an earlier node has it. */
export function strategyNames(
  state: SearchStateView,
  recorder: SearchRecorder,
  codec: SearchArtifactCodec<StrategyNode>,
): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  for (const node of state.nodes()) {
    const artifact = codec.load(recorder, node)
    const base = artifact.name ?? 'refused-module'
    const name = taken.has(base) ? `${base}~${node.ordinal}` : base
    taken.add(name)
    names.set(node.nodeId, name)
  }
  return names
}
