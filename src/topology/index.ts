/**
 * @experimental
 *
 * `@tangle-network/agent-runtime/topology` — the live recursive-agent-tree projection over the
 * lifecycle hook stream. Attach `createTopologyView().hooks` to a `Supervisor`/`runLoop` and read
 * `.render()` for the agent tree; or fold a journal replay with `renderTopologyTree`.
 */

export type {
  RenderOptions,
  TopologyNode,
  TopologyStatus,
  TopologyView,
} from './tree'
export { createTopologyView, renderTopologyTree } from './tree'
