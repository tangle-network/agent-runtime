import type { LoopGraphEvent, LoopTraceGraph, LoopTraceSelector } from './loop-types'

export function selectLoopTrace(
  source: LoopTraceGraph | { readonly trace: LoopTraceGraph },
  selector: LoopTraceSelector = {},
): LoopTraceGraph {
  const graph = 'trace' in source ? source.trace : source
  const selectedEvents = graph.events.filter((event) => eventMatches(event, selector))
  const selectedEventIds = new Set(selectedEvents.map((event) => event.id))
  const selectedEdges = graph.edges.filter(
    (edge) =>
      selectedEventIds.has(edge.eventId ?? '') ||
      endpointMatches(edge.from, edge.to, selector) ||
      (selector.includeRelated === true &&
        selectedEvents.some((event) => event.source === edge.from || event.target === edge.to)),
  )
  const nodeIds = new Set<string>()
  for (const event of selectedEvents) {
    if (event.source) nodeIds.add(event.source)
    if (event.target) nodeIds.add(event.target)
  }
  for (const edge of selectedEdges) {
    nodeIds.add(edge.from)
    nodeIds.add(edge.to)
  }
  if (selector.nodeId) nodeIds.add(selector.nodeId)
  const nodes =
    selector.includeRelated === false && selectedEvents.length === 0 && selectedEdges.length === 0
      ? []
      : graph.nodes.filter((node) => nodeIds.has(node.id))
  return {
    runId: graph.runId,
    startedAt: graph.startedAt,
    ...(graph.endedAt !== undefined ? { endedAt: graph.endedAt } : {}),
    nodes,
    edges: selectedEdges,
    events: selectedEvents,
  }
}

function eventMatches(event: LoopGraphEvent, selector: LoopTraceSelector): boolean {
  if (selector.packetId && event.packetId !== selector.packetId) return false
  if (selector.nodeId && event.source !== selector.nodeId && event.target !== selector.nodeId)
    return false
  if (selector.source && event.source !== selector.source) return false
  if (selector.target && event.target !== selector.target) return false
  if (selector.pair && !endpointMatches(event.source, event.target, selector)) return false
  if (selector.types && !selector.types.includes(event.type)) return false
  if (selector.predicate && !selector.predicate(event)) return false
  return true
}

function endpointMatches(
  source: string | undefined,
  target: string | undefined,
  selector: LoopTraceSelector,
): boolean {
  if (selector.nodeId && source !== selector.nodeId && target !== selector.nodeId) return false
  if (selector.source && source !== selector.source) return false
  if (selector.target && target !== selector.target) return false
  if (!selector.pair) return true
  const [a, b] = selector.pair
  return (source === a && target === b) || (source === b && target === a)
}
