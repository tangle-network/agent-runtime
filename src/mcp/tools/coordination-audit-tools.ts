import type { McpToolDescriptor } from '../server'
import type { BlockedToolReport, CoordinationToolsOptions } from './coordination-contracts'
import type { JournalPage } from './coordination-events'
import { JOURNAL_READ_BOUNDS, journalEventKinds } from './coordination-events'
import { obj, str } from './coordination-input'
import { runWithin } from './coordination-tool-timeout'
export function createAuditTools({
  opts,
  tools,
  blockedReports,
  readJournal,
}: {
  readonly opts: CoordinationToolsOptions
  readonly tools: () => ReadonlyArray<McpToolDescriptor>
  readonly blockedReports: BlockedToolReport[]
  readonly readJournal: (raw: unknown, trackOwnRead?: boolean) => JournalPage
}): McpToolDescriptor[] {
  return [
    {
      name: 'report_blocked',
      description: [
        'Report that a tool you need keeps failing.',
        'Name the tool, the arguments you called it with, and the error you saw.',
        'The coordinator calls that tool again, with those arguments, under your identity.',
        'When the call succeeds you are not blocked: the reply carries its result, and you continue.',
        'When it fails again, the record keeps both errors and the run goes on: work around the tool,',
        'or end your turn and be woken later. A blocked tool never ends the run; turns in a row',
        'that end without progress make Runtime wait longer before each next turn.',
        'submit_result, stop and report_blocked cannot be probed.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'The tool that failed, as you called it.' },
          arguments: {
            type: 'object',
            description: 'The arguments you called it with. Omit for none.',
          },
          error: { type: 'string', description: 'The error the tool returned to you.' },
        },
        required: ['tool', 'error'],
        additionalProperties: false,
      },
      handler: async (raw) => {
        const a = obj(raw)
        const named = str(a.tool, 'tool')
        const reported = str(a.error, 'error')
        // A harness names an MCP tool with its server alias in front; the probe wants the bare name.
        const bare = named.replace(/^mcp__.+?__/u, '').replace(/^.*?coordination_+/u, '')
        if (unprobeableVerbs.has(bare)) {
          return {
            blocked: false,
            error: 'unprobeable' as const,
            reason: `${bare} changes the run, so the coordinator does not call it for you`,
          }
        }
        const target = opts.resolveProbeTool?.(bare) ?? tools().find((tool) => tool.name === bare)
        if (target === undefined) {
          return {
            blocked: false,
            error: 'unknown-tool' as const,
            reason: `no tool named ${JSON.stringify(bare)} is served to you, so there is nothing to probe; call the tools you were given`,
          }
        }
        const args =
          a.arguments === undefined
            ? {}
            : typeof a.arguments === 'object' && a.arguments !== null && !Array.isArray(a.arguments)
              ? a.arguments
              : undefined
        if (args === undefined) {
          return {
            blocked: false,
            error: 'invalid-arguments' as const,
            reason: '"arguments" must be an object',
          }
        }
        let probe:
          | { readonly ok: true; readonly result: unknown }
          | { readonly ok: false; readonly error: string }
        try {
          probe = {
            ok: true,
            result: await runWithin(
              target.handler(structuredClone(args)),
              REPORT_BLOCKED_PROBE_MS,
              `the probe of ${bare} did not answer within ${REPORT_BLOCKED_PROBE_MS}ms`,
            ),
          }
        } catch (error) {
          probe = { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        if (probe.ok) {
          return {
            blocked: false,
            probe: { tool: bare, ok: true, result: probe.result },
            guidance:
              'The call worked when the coordinator made it under your identity, so the tool is ' +
              'not blocked. Use this result and continue the objective.',
          }
        }
        blockedReports.push(
          Object.freeze({
            tool: bare,
            reported,
            probed: probe.error,
            at: new Date().toISOString(),
          }),
        )
        return {
          blocked: true,
          probe: { tool: bare, ok: false, error: probe.error },
          guidance:
            'The call failed when the coordinator made it too, and the record keeps both errors. ' +
            'The run does not end on a blocked tool. Continue with the work that does not need it, ' +
            'or end your turn: you will be woken, and the tool may work then. Turns in a row that ' +
            'end without progress make Runtime wait longer before each next turn.',
        }
      },
    },
    {
      name: 'read_journal',
      description: [
        'Re-read YOUR OWN coordination journal: every spawn you made, every worker that settled,',
        'every question raised or decided, every steer you authorized, and every analyst finding —',
        'oldest first, on this node only, including what you did before a restart. Read it before',
        'deciding what to do next, so you can see what you already tried. Bounded: page with the',
        'returned `nextRow`, and check `truncated` before concluding you have read everything.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          sinceRow: {
            type: 'integer',
            minimum: 0,
            description:
              'First journal row to return (inclusive, 0 = the first record of the run). Pass the previous call’s `nextRow` to continue.',
          },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: [...journalEventKinds] },
            description: 'Return only these event kinds. Omit for every kind.',
          },
          // No `maximum` here on purpose: the handler CLAMPS an over-large ask and reports the bound
          // it applied in `bounds`. Declaring a maximum too would make a validating transport reject
          // the same call the handler is designed to accept and narrow.
          limit: {
            type: 'integer',
            minimum: 1,
            description: `Maximum rows to return. Default ${JOURNAL_READ_BOUNDS.defaultLimit}; anything above ${JOURNAL_READ_BOUNDS.maxLimit} is clamped to it.`,
          },
          maxBytes: {
            type: 'integer',
            minimum: 1,
            description: `Byte budget for the returned rows. Default ${JOURNAL_READ_BOUNDS.defaultMaxBytes}; anything above ${JOURNAL_READ_BOUNDS.maxMaxBytes} is clamped to it.`,
          },
        },
        additionalProperties: false,
      },
      // async so an argument the manager got wrong surfaces as a REJECTED tool call the transport
      // reports back to it, never as a synchronous throw through the server's dispatch.
      handler: async (raw) => readJournal(raw),
    },
  ]
}

const unprobeableVerbs: ReadonlySet<string> = new Set(['submit_result', 'stop', 'report_blocked'])

const REPORT_BLOCKED_PROBE_MS = 60_000
