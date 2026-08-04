/**
 *
 * Provider-neutral UI audit data, parsing, validation, and prompt helpers.
 *
 * @experimental
 */

export { buildAuditorSystemPrompt, LENS_BRIEFS, SHARED_AUDITOR_RULES } from './lens-prompts'
export { parseAuditorEvents } from './output-adapter'
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
