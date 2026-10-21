/**
 *
 * Provider-neutral UI audit data, parsing, validation, and prompt helpers.
 *
 * @experimental
 */

export { buildAuditorSystemPrompt, LENS_BRIEFS, SHARED_AUDITOR_RULES } from './lens-prompts'
export { parseAuditorEvents } from './output-adapter'
export type { UiFinding, UiLens } from './substrate'
export type { UiAuditCapture, UiAuditCaptureRequest, UiAuditTask } from './task'
