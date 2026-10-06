/**
 * Analyst lenses a supervised manager reads: the agent-eval trace-analyst registry adapted to the
 * `analysts` option (`analystsFromRegistry`), and `failuresAnalyst`, which reports the tests still
 * failing in the latest structured `run_tests` span and refuses to infer them from worker prose.
 */
import { randomUUID } from 'node:crypto'
import {
  createTraceAnalyst,
  DEFAULT_TRACE_ANALYST_KINDS,
  OUTPUT_VALUE,
  type RegistryRunOpts,
  type TraceAnalysisEngine,
  type TraceAnalysisStore,
  type TraceAnalystDefinition,
} from '@tangle-network/agent-eval'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { AnalystRegistryAuthoringLike, AnalystRegistryLike } from '../analyst-loop/types'
import { ValidationError } from '../errors'
import type {
  AnalystKind,
  AnalystRegistry,
  AuthoredAnalystDefinition,
} from '../mcp/tools/coordination'
import { isTraceAnalysisStore } from './supervise/trace-evidence'

/**
 * Adapt an `agent-eval` `AnalystRegistry` into the lens shape `supervise({ analysts })` takes.
 *
 * The two registries were never structurally compatible: eval's class exposes `list()` and
 * `run(runId, inputs, opts)` and returns an `AnalystRunResult`, while `supervise` wants `kinds`
 * and `run(kindId, trace)`. So `'kinds' in buildDefaultAnalystRegistry()` is `false` and the five
 * calibrated lenses in `DEFAULT_TRACE_ANALYST_KINDS` were unreachable from any supervised run —
 * every consumer hand-rolled a lens instead (#630).
 *
 * The adapter lives HERE, not in eval, for one reason: eval must never import runtime, and runtime
 * already owns both shapes — it consumes `AnalystFinding` / `AnalystRunResult` from eval for its
 * analyst loop and defines the supervise lens itself. Writing it in eval would mean eval declaring
 * a duck-typed copy of a type this package already exports.
 *
 * `kinds` is the DEFINITION list, not `registry.list()`, because `Analyst` carries no `area` while
 * `TraceAnalystDefinition` does — `list()` cannot supply the field the lens shape requires. Every
 * id must be registered: an unknown kind throws at adapt time rather than returning nothing at run
 * time, when the driver would read the silence as "no findings".
 */
export function analystsFromRegistry(
  registry: AnalystRegistryLike,
  kinds: ReadonlyArray<{
    id: string
    description: string
    area: string
  }> = DEFAULT_TRACE_ANALYST_KINDS,
  opts?: { runOpts?: RegistryRunOpts; authoring?: AnalystAuthoring },
): AnalystRegistry {
  const registered = new Set(registry.list().map((analyst) => analyst.id))
  const missing = kinds.map((kind) => kind.id).filter((id) => !registered.has(id))
  if (missing.length > 0) {
    throw new ValidationError(
      `analystsFromRegistry: ${missing.map((id) => JSON.stringify(id)).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not registered; the registry has ${[...registered].map((id) => JSON.stringify(id)).join(', ') || '<none>'}`,
    )
  }
  const adapted = kinds.map((kind) => ({
    id: kind.id,
    description: kind.description,
    area: kind.area,
  }))
  const authoring = opts?.authoring
  if (
    authoring !== undefined &&
    typeof (registry as Partial<AnalystRegistryAuthoringLike>).register !== 'function'
  ) {
    throw new ValidationError(
      'analystsFromRegistry: `authoring` needs a registry with `register`; pass the agent-eval AnalystRegistry itself, not a read-only shim',
    )
  }
  const authoringRegistry = registry as AnalystRegistryAuthoringLike
  return {
    kinds: adapted,
    run: async (kindId, trace) => {
      const result = await registry.run(
        `supervise-analyst-${kindId}-${randomUUID()}`,
        { traceStore: trace },
        { ...opts?.runOpts, only: [kindId] },
      )
      // Registry failures are isolated, not successful reviews with zero findings.
      const summary = result.per_analyst.find((entry) => entry.analyst_id === kindId)
      if (summary?.status !== 'ok') {
        throw new ValidationError(
          `analyst ${JSON.stringify(kindId)} did not complete: ${summary?.status ?? 'missing result'}`,
        )
      }
      return result.findings
    },
    ...(authoring === undefined
      ? {}
      : {
          register: (definition: AuthoredAnalystDefinition): AnalystKind => {
            // The seat is a REQUEST. `resolveEngine` is the authority: it returns the engine for a
            // model this run can serve and THROWS for one it cannot, and the coordination layer
            // turns that message into the manager's refusal reason.
            const engine = authoring.resolveEngine(definition.model)
            const analyst = createTraceAnalyst(traceAnalystFromAuthored(definition), {
              engine,
              ...(authoring.settlementTimeoutMs === undefined
                ? {}
                : { settlementTimeoutMs: authoring.settlementTimeoutMs }),
            })
            try {
              authoringRegistry.register(analyst)
            } catch (error) {
              // The registry is shared by every manager of the run, so an id is unique across the
              // whole tree, not just this manager's menu. Say that, or the manager reads a library
              // message about a lens it has never been shown and cannot tell what to change.
              throw new ValidationError(
                `the lens id ${JSON.stringify(definition.id)} is already registered for this run — analyst ids are shared by every manager in the tree, so pick a more specific id: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
            return { id: definition.id, description: definition.description, area: definition.area }
          },
        }),
  }
}

/**
 * What `analystsFromRegistry` needs before a manager may define its own lens.
 *
 * Only the ENGINE is asked for, because everything else about a defined lens is already in the
 * manager's own words. The engine is the model seat plus the recursive investigation loop, and it
 * cannot come from a tool argument: an `AgentProfile` names a model the run's own model policy has
 * already fenced, but an analyst engine is host-constructed with host credentials.
 */
export interface AnalystAuthoring {
  /**
   * Resolve the investigation engine for the seat a definition asked for. `undefined` means the
   * definition named no seat and wants the run's default engine. THROW to refuse a seat this run
   * cannot serve — the message is what the manager reads and re-authors from.
   */
  readonly resolveEngine: (model: string | undefined) => TraceAnalysisEngine
  /** Forwarded to `createTraceAnalyst`; omit for its default. */
  readonly settlementTimeoutMs?: number
}

/**
 * Map an authored definition onto the eval definition `createTraceAnalyst` compiles.
 *
 * The version is DERIVED from the definition's own canonical digest, never supplied by the manager.
 * That is what makes an invented lens reproducible: the same authored words always compile to the
 * same version, two different wordings can never share one, and a finding's `analyst_id`
 * plus version names the exact text that produced it.
 */
function traceAnalystFromAuthored(definition: AuthoredAnalystDefinition): TraceAnalystDefinition {
  return {
    id: definition.id,
    description: definition.description,
    area: definition.area,
    version: `1.0.0+authored.${canonicalCandidateDigest(definition).slice(-12)}`,
    question: definition.question,
    instructions: definition.instructions,
    toolGroup: definition.toolGroup,
    ...(definition.limits === undefined ? {} : { limits: definition.limits }),
    ...(definition.minimumEvidenceCitations === undefined
      ? {}
      : { minimumEvidenceCitations: definition.minimumEvidenceCitations }),
  }
}

/** The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 *  the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 *  cases. Swap `analysts` to change what the driver improves from — that's the one knob. */
export function failuresAnalyst(): AnalystRegistry {
  return {
    kinds: [
      {
        id: 'failures',
        description: "Surface the worker's still-failing tests so the driver targets them next.",
        area: 'progress',
      },
    ],
    run: async (_kindId: string, trace: TraceAnalysisStore) => {
      if (!isTraceAnalysisStore(trace)) return missingRunTestsEvidence()
      const report = await latestRunTestsReport(trace)
      if (report === undefined) return missingRunTestsEvidence()
      const failing = failingTestNames(report)
      return {
        summary: failing.length
          ? `Latest structured run_tests evidence reports STILL FAILING (${failing.length}): ${failing.join(', ')}. Spawn the next worker to fix exactly these; if a test keeps failing across workers, give it concrete guidance about that case.`
          : allTestsPassed(report)
            ? 'Latest structured run_tests evidence reports every test passed; stop.'
            : `Latest structured run_tests evidence contains no parseable failing-test names. Refusing to infer them from worker prose. run_tests output: ${report.slice(0, 300)}`,
      }
    },
  }
}

async function latestRunTestsReport(store: TraceAnalysisStore): Promise<string | undefined> {
  const overview = await store.getOverview({ tool_names: ['run_tests'] })
  const candidates: Array<{ output: string; endedAt: string; ordinal: number }> = []
  let ordinal = 0
  for (const traceId of overview.sample_trace_ids) {
    const view = await store.viewTrace({ trace_id: traceId, per_attribute_byte_cap: 16_384 })
    let spans = view.spans
    if (spans === undefined) {
      const matches = await store.searchTrace({
        trace_id: traceId,
        regex_pattern: 'run_tests',
        max_matches: 100,
      })
      const spanIds = [
        ...new Set(
          matches.hits.filter((hit) => hit.span_name === 'run_tests').map((hit) => hit.span_id),
        ),
      ]
      spans = spanIds.length
        ? (
            await store.viewSpans({
              trace_id: traceId,
              span_ids: spanIds,
              per_attribute_byte_cap: 16_384,
            })
          ).spans
        : []
    }
    for (const span of spans) {
      if (span.tool_name !== 'run_tests') continue
      const output = span.attributes[OUTPUT_VALUE]
      if (typeof output !== 'string') continue
      candidates.push({ output, endedAt: span.end_time, ordinal: ordinal++ })
    }
  }
  candidates.sort(
    (left, right) =>
      Date.parse(left.endedAt) - Date.parse(right.endedAt) || left.ordinal - right.ordinal,
  )
  return candidates.at(-1)?.output
}

function failingTestNames(report: string): string[] {
  const body = /FAILING:\s*([^\n]+)/iu.exec(report)?.[1]
  if (body === undefined) return []
  return body
    .replace(/\.\s+COLLECTION-BLOCKED:.*$/iu, '')
    .replace(/\s*\(\+\d+\s+more\)\s*$/iu, '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

function allTestsPassed(report: string): boolean {
  const fraction = /(\d+)\s*\/\s*(\d+)\s+tests?\s+passed/iu.exec(report)
  return fraction !== null && Number(fraction[1]) === Number(fraction[2])
}

function missingRunTestsEvidence(): { summary: string } {
  return {
    summary:
      'Missing structured run_tests span evidence. Refusing to infer failing-test names from worker prose.',
  }
}
