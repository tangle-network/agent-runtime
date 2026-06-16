/**
 * The router-backed driver-LLM seam: adapt the OpenAI-compatible router's tool-calling chat
 * to the `DriverChat` port a `coordinationDriverAgent` drives. Tests script a mock `DriverChat`;
 * production passes `routerDriverChat(cfg)` so the driver's spawn/observe/steer/await/stop turns
 * are real router tool-calls. This is the one turnkey piece a consumer needs to run an in-process
 * supervisor (the driver brain) — everything else is `createSupervisor().run(...)`.
 */

import { type RouterConfig, routerChatWithTools } from '../router-client'
import type { DriverChat, DriverMessage } from './coordination-driver'

export function routerDriverChat(c: RouterConfig, opts: { temperature?: number } = {}): DriverChat {
  const temperature = opts.temperature ?? 0.4
  return {
    next: async ({ system, messages, tools }) => {
      const oa: Array<Record<string, unknown>> = [
        { role: 'system', content: system },
        ...messages.map(toOpenAI),
      ]
      const oaTools = tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      const r = await routerChatWithTools(c, oa, oaTools, { temperature, toolChoice: 'auto' })
      return {
        ...(r.content ? { content: r.content } : {}),
        toolCalls: r.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: safeParse(tc.arguments),
        })),
      }
    },
  }
}

function toOpenAI(m: DriverMessage): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content ?? '',
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id ?? tc.name,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    }
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? m.name ?? 'call', content: m.content }
  }
  return { role: m.role, content: m.content }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}
