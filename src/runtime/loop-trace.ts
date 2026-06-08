import type { LoopEvent, LoopTraceSelector, LoopTraceSlice } from './loop-types'

export function selectLoopTrace(
  source: LoopTraceSlice | { readonly trace: LoopTraceSlice },
  selector: LoopTraceSelector = {},
): LoopTraceSlice {
  const trace = 'trace' in source ? source.trace : source
  const events = trace.events.filter((event) => eventMatches(event, selector))
  const eventArtifactIds = new Set(events.flatMap((event) => event.artifactId ?? []))
  const artifacts = trace.artifacts.filter((artifact) => {
    if (selector.artifactId && artifact.id !== selector.artifactId) return false
    if (selector.source && artifact.source !== selector.source) return false
    if (selector.includeRelated !== false && eventArtifactIds.has(artifact.id)) return true
    if (!selector.artifactId && !selector.source && !selector.target && !selector.pair) return true
    return endpointMatches(artifact.source, undefined, selector)
  })
  return { runId: trace.runId, artifacts, events }
}

function eventMatches(event: LoopEvent, selector: LoopTraceSelector): boolean {
  if (selector.artifactId && event.artifactId !== selector.artifactId) return false
  if (selector.source && event.source !== selector.source) return false
  if (selector.target && event.target !== selector.target) return false
  if (selector.pair && !endpointMatches(event.source, event.target, selector)) return false
  if (selector.kinds && !selector.kinds.includes(event.kind)) return false
  if (selector.predicate && !selector.predicate(event)) return false
  return true
}

function endpointMatches(
  source: string | undefined,
  target: string | undefined,
  selector: LoopTraceSelector,
): boolean {
  if (selector.source && source !== selector.source) return false
  if (selector.target && target !== selector.target) return false
  if (!selector.pair) return true
  const [a, b] = selector.pair
  return (source === a && target === b) || (source === b && target === a)
}
