/**
 * @experimental
 *
 * `delegate_ui_audit` MCP tool — async kickoff for UI audit runs. Same
 * async semantics as `delegate_code` / `delegate_research`: validates the
 * input, computes an idempotency key over the canonical fields, hands
 * the task to the queue, and returns a taskId. Identical inputs return
 * the same taskId.
 *
 * The handler does not import the auditor profile directly — consumers
 * inject a `UiAuditorDelegate` via `createMcpServer({ uiAuditorDelegate })`.
 * The delegate is the seam where the consumer chooses the judge (vision
 * model) and the `LoopSandboxClient` (in-process Playwright vs fleet vs
 * remote browser). agent-runtime ships the in-process client under
 * `./profiles` so consumers who want the canonical setup can wire it
 * with a few lines.
 */

import path from 'node:path'
import { UI_LENSES, type UiLens } from '../../profiles/ui-auditor/substrate'
import type { UiAuditorDelegate } from '../delegates'
import {
  type DelegateUiAuditArgs,
  type DelegateUiAuditResult,
  type DelegationTaskQueue,
  hashIdempotencyInput,
} from '../task-queue'

/** @experimental */
export const DELEGATE_UI_AUDIT_TOOL_NAME = 'delegate_ui_audit'

/** @experimental */
export const DELEGATE_UI_AUDIT_DESCRIPTION = [
  'Delegate a UI/UX audit to a vision-driven auditor that produces self-contained',
  'GitHub-issue-ready Markdown findings — one file per finding, with embedded',
  'screenshot evidence and a suggested fix.',
  '',
  'Use when: you want a thorough pass over a running web app for consistency,',
  'hierarchy, layout, ux-flow, duplication, accessibility, responsive, states,',
  'content, interaction, or perceived-performance issues. The auditor iterates',
  'lens-by-lens so each pass finds new classes of issues; the workspace registry',
  'deduplicates across iterations.',
  '',
  'Returns immediately with a taskId. Poll delegation_status to retrieve the',
  'workspace path + indexed findings (typically minutes per audited route).',
  'Identical inputs return the same taskId — safe to retry.',
  '',
  'Output layout under workspaceDir:',
  '  registry.json                       — finding index + capture sidecar',
  '  index.md                            — human-readable rollup',
  '  issues/NNN--<lens>--<slug>.md       — one self-contained GitHub-issue',
  '  screenshots/<route>--<viewport>.png — capture archive',
  '',
  'Multi-tenant isolation: every finding is scoped to `namespace` when set.',
  "Never pass another tenant's namespace.",
].join('\n')

const VIEWPORT_SCHEMA = {
  type: 'object',
  properties: {
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
  },
  required: ['width', 'height'],
  additionalProperties: false,
} as const

const ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Stable route name (used in screenshot filenames).' },
    url: { type: 'string', description: 'Fully-qualified URL.' },
    viewports: {
      type: 'array',
      items: VIEWPORT_SCHEMA,
      description: 'Viewports to capture at. Default [{1280, 800}].',
    },
    fullPage: { type: 'boolean' },
    waitFor: { type: 'string', description: 'CSS selector to wait for before capturing.' },
  },
  required: ['name', 'url'],
  additionalProperties: false,
} as const

/** @experimental */
export const DELEGATE_UI_AUDIT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    workspaceDir: { type: 'string', description: 'Absolute path for the audit workspace.' },
    routes: { type: 'array', items: ROUTE_SCHEMA, minItems: 1 },
    namespace: { type: 'string', description: 'Multi-tenant scope.' },
    config: {
      type: 'object',
      properties: {
        lenses: {
          type: 'array',
          items: { type: 'string', enum: [...UI_LENSES] },
          description: 'Lenses to iterate. Default: every lens except "other".',
        },
        maxIterations: { type: 'integer', minimum: 1 },
        maxConcurrency: { type: 'integer', minimum: 1 },
        productContext: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['workspaceDir', 'routes'],
  additionalProperties: false,
} as const

const PER_LENS_PER_ROUTE_ESTIMATE_MS = 45_000

/** @experimental */
export function validateDelegateUiAuditArgs(raw: unknown): DelegateUiAuditArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_ui_audit: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const workspaceDir = value.workspaceDir
  if (typeof workspaceDir !== 'string' || workspaceDir.trim().length === 0) {
    throw new TypeError('delegate_ui_audit: `workspaceDir` must be a non-empty string')
  }
  // Reject relative paths at the boundary. Without this, the writer joins a
  // relative workspaceDir against the process CWD, so the same MCP call
  // produces different file layouts depending on where the server was
  // launched — a silent fail-loud violation for a public API.
  const trimmedWs = workspaceDir.trim()
  if (!path.isAbsolute(trimmedWs)) {
    throw new TypeError(
      `delegate_ui_audit: \`workspaceDir\` must be an absolute path (got ${JSON.stringify(workspaceDir)})`,
    )
  }
  // Reject `..` segments. An absolute path like `/tmp/../../etc` passes
  // `isAbsolute`, then `path.join(workspaceDir, 'issues', …)` normalises it
  // to `/etc/issues/…`, escaping the intended workspace. Check the RAW
  // input split on the platform separator; `path.resolve` already collapses
  // `..` and would silently launder a traversal attempt past us.
  if (trimmedWs.split(path.sep).includes('..')) {
    throw new TypeError(
      `delegate_ui_audit: \`workspaceDir\` must not contain '..' segments (got ${JSON.stringify(workspaceDir)})`,
    )
  }
  const routesRaw = value.routes
  if (!Array.isArray(routesRaw) || routesRaw.length === 0) {
    throw new TypeError('delegate_ui_audit: `routes` must be a non-empty array')
  }
  const routes = routesRaw.map((r, i) => validateRoute(r, i))
  const args: DelegateUiAuditArgs = { workspaceDir: workspaceDir.trim(), routes }
  if (value.namespace !== undefined) {
    if (typeof value.namespace !== 'string' || value.namespace.trim().length === 0) {
      throw new TypeError('delegate_ui_audit: `namespace` must be a non-empty string when set')
    }
    args.namespace = value.namespace.trim()
  }
  if (value.config !== undefined) {
    args.config = validateConfig(value.config)
  }
  return args
}

function validateRoute(raw: unknown, index: number): DelegateUiAuditArgs['routes'][number] {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError(`delegate_ui_audit: routes[${index}] must be an object`)
  }
  const v = raw as Record<string, unknown>
  if (typeof v.name !== 'string' || v.name.trim().length === 0) {
    throw new TypeError(`delegate_ui_audit: routes[${index}].name must be a non-empty string`)
  }
  // Defense-in-depth: the slug helpers downstream strip non-alphanumerics, so
  // a route name with `..`, `/`, `\`, or NUL cannot actually escape the
  // workspace. Rejecting them at the wire boundary keeps the invariant
  // explicit and matches the lens-allowlist style of validation.
  const trimmedName = v.name.trim()
  if (/[./\\]/.test(trimmedName) || trimmedName.includes('\u0000')) {
    throw new TypeError(
      `delegate_ui_audit: routes[${index}].name must not contain path separators, dots, or NUL (got ${JSON.stringify(v.name)})`,
    )
  }
  if (typeof v.url !== 'string' || v.url.trim().length === 0) {
    throw new TypeError(`delegate_ui_audit: routes[${index}].url must be a non-empty string`)
  }
  // Parse + restrict to http/https. The in-process auditor client navigates
  // to whatever URL the MCP caller supplies; permitting `file://`, `data:`,
  // `javascript:` would let an attacker controlling the tool input pull
  // local files or run inline scripts.
  let parsedUrl: URL
  try {
    parsedUrl = new URL(v.url)
  } catch {
    throw new TypeError(
      `delegate_ui_audit: routes[${index}].url is not a parseable URL (got ${JSON.stringify(v.url)})`,
    )
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new TypeError(
      `delegate_ui_audit: routes[${index}].url must use http or https (got ${parsedUrl.protocol})`,
    )
  }
  const out: DelegateUiAuditArgs['routes'][number] = { name: v.name.trim(), url: v.url.trim() }
  if (v.viewports !== undefined) {
    if (!Array.isArray(v.viewports) || v.viewports.length === 0) {
      throw new TypeError(
        `delegate_ui_audit: routes[${index}].viewports must be a non-empty array when set`,
      )
    }
    out.viewports = v.viewports.map((vp, j) => validateViewport(vp, index, j))
  }
  if (v.fullPage !== undefined) {
    if (typeof v.fullPage !== 'boolean') {
      throw new TypeError(`delegate_ui_audit: routes[${index}].fullPage must be a boolean`)
    }
    out.fullPage = v.fullPage
  }
  if (v.waitFor !== undefined) {
    if (typeof v.waitFor !== 'string' || v.waitFor.trim().length === 0) {
      throw new TypeError(
        `delegate_ui_audit: routes[${index}].waitFor must be a non-empty string when set`,
      )
    }
    out.waitFor = v.waitFor.trim()
  }
  return out
}

function validateViewport(
  raw: unknown,
  routeIndex: number,
  viewportIndex: number,
): { width: number; height: number } {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError(
      `delegate_ui_audit: routes[${routeIndex}].viewports[${viewportIndex}] must be an object`,
    )
  }
  const v = raw as Record<string, unknown>
  const w = Number(v.width)
  const h = Number(v.height)
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new RangeError(
      `delegate_ui_audit: routes[${routeIndex}].viewports[${viewportIndex}] must have positive integer width/height`,
    )
  }
  return { width: w, height: h }
}

function validateConfig(raw: unknown): DelegateUiAuditArgs['config'] {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_ui_audit: `config` must be an object')
  }
  const v = raw as Record<string, unknown>
  const out: NonNullable<DelegateUiAuditArgs['config']> = {}
  if (v.lenses !== undefined) {
    if (!Array.isArray(v.lenses) || v.lenses.length === 0) {
      throw new TypeError('delegate_ui_audit: `config.lenses` must be a non-empty array when set')
    }
    const knownSet = new Set<string>(UI_LENSES)
    const lenses: UiLens[] = []
    for (let i = 0; i < v.lenses.length; i += 1) {
      const lens = v.lenses[i]
      if (typeof lens !== 'string' || !knownSet.has(lens)) {
        throw new TypeError(
          `delegate_ui_audit: config.lenses[${i}] must be one of ${UI_LENSES.join('|')}`,
        )
      }
      lenses.push(lens as UiLens)
    }
    out.lenses = lenses
  }
  if (v.maxIterations !== undefined) {
    const n = Number(v.maxIterations)
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('delegate_ui_audit: `config.maxIterations` must be a positive integer')
    }
    out.maxIterations = n
  }
  if (v.maxConcurrency !== undefined) {
    const n = Number(v.maxConcurrency)
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('delegate_ui_audit: `config.maxConcurrency` must be a positive integer')
    }
    out.maxConcurrency = n
  }
  if (v.productContext !== undefined) {
    if (typeof v.productContext !== 'string') {
      throw new TypeError('delegate_ui_audit: `config.productContext` must be a string')
    }
    out.productContext = v.productContext
  }
  return out
}

/** @experimental */
export interface DelegateUiAuditHandlerOptions {
  queue: DelegationTaskQueue
  delegate: UiAuditorDelegate
  estimateDurationMs?: (args: DelegateUiAuditArgs) => number
}

/** @experimental */
export function createDelegateUiAuditHandler(
  options: DelegateUiAuditHandlerOptions,
): (raw: unknown) => Promise<DelegateUiAuditResult> {
  const estimateDurationMs = options.estimateDurationMs ?? defaultEstimate
  return async (raw) => {
    const args = validateDelegateUiAuditArgs(raw)
    const idempotencyKey = hashIdempotencyInput({
      profile: 'ui-auditor',
      workspaceDir: args.workspaceDir,
      routes: args.routes,
      namespace: args.namespace,
      config: args.config,
    })
    const submitted = options.queue.submit<DelegateUiAuditArgs>({
      profile: 'ui-auditor',
      args,
      namespace: args.namespace,
      idempotencyKey,
      run: async (ctx) => options.delegate(args, ctx),
    })
    return {
      taskId: submitted.taskId,
      estimatedDurationMs: estimateDurationMs(args),
    }
  }
}

function defaultEstimate(args: DelegateUiAuditArgs): number {
  const lenses = args.config?.lenses?.length ?? UI_LENSES.length - 1
  const routes = args.routes.length
  return PER_LENS_PER_ROUTE_ESTIMATE_MS * lenses * routes
}
