import type { TraceAnalysisStore } from '@tangle-network/agent-eval'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { workerTraceAnalysisStore } from '../../runtime/supervise/trace-evidence'
import type { McpToolDescriptor } from '../server'
import type { createCoordinationAnalysis } from './coordination-analysis'
import { ANALYST_DEFINITION_BOUNDS, analystToolGroupNames } from './coordination-analysts'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import { obj, str } from './coordination-input'
import type { createSpawnAdmission } from './coordination-spawn-admission'
import { idArg } from './coordination-worker-argument'
export function mountAnalystsTools({
  opts,
  tools,
  ledger,
  nodeForWorker,
  analystMenu,
  analystRunContext,
  defineAnalyst,
}: {
  readonly opts: CoordinationToolsOptions
  readonly tools: McpToolDescriptor[]
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly nodeForWorker: ReturnType<typeof createSpawnAdmission>['nodeForWorker']
  readonly analystMenu: ReturnType<typeof createCoordinationAnalysis>['analystMenu']
  readonly analystRunContext: ReturnType<typeof createCoordinationAnalysis>['analystRunContext']
  readonly defineAnalyst: ReturnType<typeof createCoordinationAnalysis>['defineAnalyst']
}): void {
  if (opts.analysts) {
    tools.push({
      name: 'list_analysts',
      description:
        'List trace-analyst lenses available to run over a settled worker — the ones this run was ' +
        'given plus any you defined with define_analyst.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: analystMenu() }),
    })
    tools.push({
      name: 'run_analyst',
      description: 'Apply an analyst lens to a settled worker trace.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'The analyst kind id.' },
          workerId: idArg,
        },
        required: ['kind', 'workerId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const id = str(a.workerId, 'workerId')
        const node = nodeForWorker(id)
        if (!node)
          return {
            error: 'unknown-worker' as const,
            reason: `no worker of this manager has the id ${JSON.stringify(id)}; spawn_worker returns the ids you may analyze`,
          }
        if (isLiveNodeStatus(node.status)) {
          return {
            error: 'worker-not-settled' as const,
            reason: `worker ${JSON.stringify(id)} has not settled, so it has no trace to analyze yet — end your turn until it settles, then run the lens`,
          }
        }
        const trace =
          ledger.find((worker) => worker.id === id)?.trace ??
          node.trace ??
          ({
            status: 'unavailable',
            reason: 'legacy-settlement-without-trace-evidence',
          } as const)
        let store: TraceAnalysisStore
        try {
          store = await workerTraceAnalysisStore(trace, opts.blobs)
        } catch (error) {
          return {
            error: 'trace-unreadable' as const,
            reason: `the settled worker's trace evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
            trace,
          }
        }
        // The registry a run installs is SHARED by every manager in the tree, and a lens one
        // manager defined is registered in it. Without this fence a sibling could run a lens it was
        // never shown, spending the run's account on another manager's authored instructions. The
        // menu is the grant: a kind not on it is refused here, before the registry is asked.
        const kind = str(a.kind, 'kind')
        if (!analystMenu().some((entry) => entry.id === kind)) {
          return {
            error: 'unknown-analyst' as const,
            reason: `no lens named ${JSON.stringify(kind)} is on this manager's menu; call list_analysts to see what you may run`,
          }
        }
        return { findings: await opts.analysts?.run(kind, store, analystRunContext(kind, id)) }
      },
    })
    if (opts.analysts.register) {
      tools.push({
        name: 'define_analyst',
        description: [
          'Define a NEW trace-analyst lens for this run, then run it with run_analyst like any',
          'other. You write the research question, the policy for answering it, which trace tools',
          'it may use, and the model seat — data only, never code. The definition is journaled, so',
          'the lens you invented is reproducible and attributed to you.',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Stable lens id: lowercase letters, digits and hyphens, 2-64 characters. It is the `kind` you pass to run_analyst and the analyst_id on every finding.',
            },
            description: {
              type: 'string',
              description: `One line naming what this lens looks for. At most ${ANALYST_DEFINITION_BOUNDS.maxDescriptionChars} characters.`,
            },
            area: {
              type: 'string',
              description:
                'The finding area this lens reports under, e.g. coordination, tool-use, cost.',
            },
            question: {
              type: 'string',
              description: `The research question, in your own words. At most ${ANALYST_DEFINITION_BOUNDS.maxQuestionChars} characters.`,
            },
            instructions: {
              type: 'string',
              description: `How to answer it: evidence rules, what counts as a finding, what to refuse to infer. At most ${ANALYST_DEFINITION_BOUNDS.maxInstructionsChars} characters.`,
            },
            toolGroup: {
              type: 'string',
              enum: [...analystToolGroupNames],
              description:
                'Smallest trace-tool set that can answer the question. discovery = overview/query/count only; discoveryAndRead adds deep reads; discoveryAndSearch adds regex; targeted and singleTrace narrow further; all grants every trace tool.',
            },
            model: {
              type: 'string',
              description:
                'The model seat this lens should run on. Omit for the run default. It is a request: registration may refuse a seat this run cannot serve.',
            },
            limits: {
              type: 'object',
              properties: {
                maxIterations: {
                  type: 'integer',
                  minimum: 1,
                  maximum: ANALYST_DEFINITION_BOUNDS.maxIterations,
                },
                maxLlmCalls: {
                  type: 'integer',
                  minimum: 1,
                  maximum: ANALYST_DEFINITION_BOUNDS.maxLlmCalls,
                },
                maxToolCalls: {
                  type: 'integer',
                  minimum: 1,
                  maximum: ANALYST_DEFINITION_BOUNDS.maxToolCalls,
                },
                maxOutputChars: {
                  type: 'integer',
                  minimum: 1,
                  maximum: ANALYST_DEFINITION_BOUNDS.maxOutputChars,
                },
              },
              additionalProperties: false,
              description:
                'Investigation ceilings. Values above the maximum are clamped, not refused.',
            },
            minimumEvidenceCitations: {
              type: 'integer',
              minimum: 1,
              maximum: ANALYST_DEFINITION_BOUNDS.maxEvidenceCitations,
              description: 'Distinct evidence citations required per finding. Default 1.',
            },
          },
          required: ['id', 'description', 'area', 'question', 'instructions', 'toolGroup'],
          additionalProperties: false,
        },
        handler: async (raw) => defineAnalyst(raw),
      })
    }
  }
}
