/**
 * @experimental
 *
 * `ui-auditor` profile — vision-driven UI audit iteration preset for
 * `runLoop`. See `profile.ts` for the entry point.
 *
 * The in-process Playwright + judge client lives in `in-process-client.ts`
 * under the optional `./ui-auditor` subpath export so consumers that only
 * want the profile types do not pay the Playwright peer dep.
 */

export type {
  BrowserContextHandle,
  BrowserHandle,
  InProcessUiAuditClientOptions,
  PageHandle,
} from './in-process-client'
export { createInProcessUiAuditClient } from './in-process-client'
export type {
  UiJudge,
  UiJudgeInput,
  UiJudgeOutput,
  UiJudgeTokenUsage,
} from './judge'
export { buildAuditorSystemPrompt, LENS_BRIEFS, SHARED_AUDITOR_RULES } from './lens-prompts'
export { parseAuditorEvents } from './output-adapter'
export { type UiAuditorProfileOptions, uiAuditorProfile } from './profile'
export {
  decodeAuditTaskEnvelope,
  encodeAuditTaskEnvelope,
  formatAuditorPrompt,
} from './prompt'
export type {
  UiAuditCapture,
  UiAuditCaptureRequest,
  UiAuditOutput,
  UiAuditTask,
  UiAuditViewport,
} from './task'
export { createUiAuditorValidator } from './validator'
