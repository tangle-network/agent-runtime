/**
 * Cloudflare Workflows integration for the durable-run substrate.
 *
 * Two valid deployment patterns on Cloudflare:
 *
 *   A. **Plain Worker + D1DurableRunStore.** Each request invokes
 *      `runDurable(...)` directly against a D1 binding. Survives worker
 *      isolate restarts; lease takeover happens via D1 row-level
 *      conditional UPDATE. The default path; no Workflows binding needed.
 *
 *   B. **Cloudflare Workflows entrypoint.** Wrap an entire `runDurable(...)`
 *      call inside a single Workflow `step.do(...)`. Workflows gives you
 *      retry-on-throw with platform-managed exponential backoff and
 *      survives full Workers deploy rolls. Use it when the task can take
 *      minutes to hours, or when you want the Workflows dashboard for
 *      observability. Inside the step, `runDurable` still uses D1 for
 *      step-level checkpoints — so a half-completed run resumes from
 *      its last checkpoint on retry rather than restarting from scratch.
 *
 * This module provides the surface for pattern B: a thin helper that
 * converts a Workflows `WorkflowStep` into a `DurableContext`. We do not
 * take a runtime dep on `cloudflare:workers` — the integration is purely
 * structural typing.
 *
 * Example (pattern B):
 *
 *   import { WorkflowEntrypoint } from 'cloudflare:workers'
 *   import { runOnWorkflowStep } from '@tangle-network/agent-runtime'
 *
 *   export class LegalChatWorkflow extends WorkflowEntrypoint<Env, ChatParams> {
 *     async run(event, step) {
 *       return runOnWorkflowStep(step, {
 *         workflowName: 'legal-chat',
 *         taskFn: async (ctx) => {
 *           const ready  = await ctx.step('readiness',   () => probeKnowledge(...))
 *           const answer = await ctx.step('llm:turn-1',  () => callLlm(...))
 *           const shipped = await ctx.awaitEvent('shipped', { timeoutMs: 5 * 60_000 })
 *           return { answer, shipped }
 *         },
 *       })
 *     }
 *   }
 *
 * Step ordering, replay semantics, and divergence detection inside the
 * `taskFn` are inherited from Cloudflare's Workflows engine — we
 * intentionally do NOT layer a second durable store inside this path.
 * Pick pattern A or pattern B per agent; do not mix.
 */

import type { DurableContext } from './runner'

/**
 * Structural subset of Cloudflare's `WorkflowStep`. Mirrors the public surface
 * documented at https://developers.cloudflare.com/workflows/build/. Defined
 * here so this module imposes zero `cloudflare:workers` runtime dependency.
 */
export interface WorkflowStepLike {
  do<T>(name: string, opts: WorkflowStepConfig, fn: () => Promise<T>): Promise<T>
  do<T>(name: string, fn: () => Promise<T>): Promise<T>
  sleep(name: string, duration: string | number): Promise<void>
  waitForEvent<T = unknown>(name: string, opts: { type: string; timeout?: string }): Promise<{
    payload: T
    timestamp: number
    type: string
  }>
}

export interface WorkflowStepConfig {
  retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' }
  timeout?: string | number
}

export interface RunOnWorkflowStepInput<TResult> {
  /** Logical workflow name; used as a prefix on step ids for filtering. */
  workflowName: string
  /** User task — same shape as runDurable's taskFn. */
  taskFn: (ctx: DurableContext) => Promise<TResult>
  /** Optional per-step retry / timeout policy applied to ctx.step calls. */
  stepConfig?: WorkflowStepConfig
  /** Optional clock — defaults to Date.now. */
  now?: () => number
}

/**
 * Adapt a Cloudflare `WorkflowStep` into a `DurableContext` and run a task.
 *
 * Every `ctx.step(intent, fn)` becomes `step.do(<name>, fn)` with stable
 * names — Workflows checkpoints + replays based on step name + position,
 * matching our model.
 *
 * `ctx.awaitEvent(key)` becomes `step.waitForEvent(key, { type: key })`.
 * Caller is responsible for emitting from the platform side (e.g. via the
 * Workflows REST API or a sibling worker that publishes events).
 *
 * `ctx.now()` and `ctx.uuid()` go through `step.do` so the values are
 * captured in the platform's checkpoint state and remain stable across
 * replay — same invariant as our own stores.
 */
export async function runOnWorkflowStep<TResult>(
  workflowStep: WorkflowStepLike,
  input: RunOnWorkflowStepInput<TResult>,
): Promise<TResult> {
  const stepCfg = input.stepConfig
  let counter = 0
  const stepName = (intent: string) => `${input.workflowName}/${counter++}:${intent}`

  const ctx: DurableContext = {
    runId: `cf-workflow:${input.workflowName}`,
    projectId: input.workflowName,
    async step<T>(intent: string, fn: () => Promise<T>): Promise<T> {
      const name = stepName(intent)
      if (stepCfg) {
        return workflowStep.do<T>(name, stepCfg, fn)
      }
      return workflowStep.do<T>(name, fn)
    },
    async awaitEvent<T = unknown>(key: string, opts?: { timeoutMs?: number }): Promise<T> {
      const timeout = opts?.timeoutMs ? `${Math.ceil(opts.timeoutMs / 1000)}s` : undefined
      const ev = await workflowStep.waitForEvent<T>(stepName(`event:${key}`), {
        type: key,
        timeout,
      })
      return ev.payload
    },
    async emitEvent(): Promise<{ accepted: boolean }> {
      // Workflows events are emitted from OUTSIDE the workflow (via the
      // platform API). A workflow that emits its own events is an
      // anti-pattern — surface that fail-loud rather than silently no-op.
      throw new Error(
        'runOnWorkflowStep: ctx.emitEvent is not available inside a Workflows entrypoint. ' +
          'Emit from the sibling worker that drives the workflow.',
      )
    },
    async now(): Promise<Date> {
      const iso = await this.step('deterministic:now', async () => new Date().toISOString())
      return new Date(iso)
    },
    async uuid(): Promise<string> {
      return this.step('deterministic:uuid', async () => {
        if (typeof globalThis.crypto?.randomUUID === 'function') {
          return globalThis.crypto.randomUUID()
        }
        // Cloudflare runtime always has Web Crypto; fallback is defensive.
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
        bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      })
    },
  }

  return input.taskFn(ctx)
}
