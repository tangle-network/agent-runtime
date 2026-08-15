/**
 * tool-loop — one chat turn that calls tools until the model stops.
 *
 * The loop is the runtime's; the model and the tools stay yours. You supply
 * `streamTurn` (one model turn) and `executeToolCall` (your executors), and the
 * loop folds each result back into the conversation and re-runs the turn.
 * Offline, deterministic, no API keys.
 *
 * Run:  pnpm build && pnpm tsx examples/tool-loop/tool-loop.ts
 */

import type { OpenAIChatTool } from '@tangle-network/agent-runtime'
import {
  runToolLoop,
  type ToolCallOutcome,
  type ToolLoopCall,
  type ToolLoopEvent,
  type ToolLoopMessage,
} from '@tangle-network/agent-runtime/tool-loop'

// The tool declarations you send to the model. This is the OpenAI function
// shape every OpenAI-compatible provider accepts.
const tools: OpenAIChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_invoice',
      description: 'Read one invoice by id.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string' } },
        required: ['invoiceId'],
      },
    },
  },
]

const invoices: Record<string, { amountUsd: number; status: string }> = {
  'inv-42': { amountUsd: 120, status: 'paid' },
}

// Your executors. One call in, one typed outcome out. A failure is a value,
// not a thrown error, so the model reads the reason and can recover.
async function executeToolCall(call: ToolLoopCall): Promise<ToolCallOutcome> {
  if (call.toolName !== 'get_invoice') {
    return { ok: false, code: 'unknown_tool', message: `no tool named ${call.toolName}` }
  }
  const invoice = invoices[String(call.args.invoiceId)]
  if (!invoice) return { ok: false, code: 'not_found', message: 'no such invoice', status: 404 }
  return { ok: true, result: invoice }
}

// One model turn. A real one calls your provider with `messages` and `tools`,
// then yields text and tool calls as they arrive. This one is scripted: it asks
// for the invoice first, then answers once the result is in the history.
async function* streamTurn(messages: ToolLoopMessage[]): AsyncIterable<ToolLoopEvent> {
  const sawToolResult = messages.some((message) => message.role === 'tool')
  if (!sawToolResult) {
    yield { type: 'text', text: 'Looking up the invoice.\n' }
    yield {
      type: 'tool_call',
      call: { toolCallId: 'call_1', toolName: 'get_invoice', args: { invoiceId: 'inv-42' } },
    }
    return
  }
  yield { type: 'text', text: 'Invoice inv-42 is $120 and already paid.\n' }
}

const result = await runToolLoop({
  systemPrompt: 'You answer billing questions. Use the tools before you answer.',
  userMessage: 'Is invoice inv-42 paid?',
  streamTurn,
  executeToolCall,
  isExecutableTool: (name) => tools.some((tool) => tool.function.name === name),
  // A watchdog, not a policy cap. Real limits come from deadlineMs / maxCostUsd.
  maxToolTurns: 8,
})

console.log(result.finalText.trim())
for (const executed of result.toolResults) {
  console.log(`tool ${executed.label} → ${executed.outcome.ok ? 'ok' : executed.outcome.code}`)
}
console.log(`turns: ${result.turns} — stopReason: ${result.stopReason}`)
