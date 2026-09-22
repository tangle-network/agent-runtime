/**
 *
 * `ui-auditor` profile — vision-driven UI audit iteration preset for
 * `runAgentRounds`. See `profile.ts` for the entry point.
 *
 * The in-process Playwright + judge provider lives in `in-process-provider.ts`
 * under the optional `./ui-auditor` subpath export so consumers that only
 * want the profile types do not pay the Playwright peer dep.
 *
 * @experimental
 */

export type {
  BrowserContextHandle,
  BrowserHandle,
  InProcessUiAuditEnvironmentProvider,
  InProcessUiAuditEnvironmentProviderOptions,
  PageHandle,
} from './in-process-provider'
export { createInProcessUiAuditEnvironmentProvider } from './in-process-provider'
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
  UiFinding,
  UiFindingScreenshot,
  UiFindingSeverity,
  UiLens,
} from './substrate'
export { UI_FINDING_SEVERITIES, UI_LENSES } from './substrate'
export type {
  UiAuditCapture,
  UiAuditCaptureRequest,
  UiAuditOutput,
  UiAuditTask,
  UiAuditViewport,
} from './task'
export { createUiAuditorValidator } from './validator'
