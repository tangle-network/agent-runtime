/**
 *
 * Authored `AgentProfile` presets (the §1.5 author-the-profile DATA) for common agent roles, each
 * with a pure task-to-prompt formatter. The substrate materializes a profile into a harness
 * invocation; "is it delivered" is a `DeliverableSpec`, not a bundled validator.
 *
 * @experimental
 */

// The judge-agnostic UI-audit workspace I/O helpers (persist a `UiFinding[]` to a
// workspace, regardless of how the findings were produced).
export type {
  AppendFindingsResult,
  AuditIndex,
  AuditRegistry,
  AuditRegistryCapture,
  RegisterCapturesOptions,
} from '../audit'
export {
  appendFindings,
  initAuditWorkspace,
  readAuditRegistry,
  registerCaptures,
  summarizeRegistry,
  writeAuditIndex,
} from '../audit'
export type { CoderTask } from './coder'
export { coderTaskToPrompt } from './coder'
export type {
  BrowserContextHandle,
  BrowserHandle,
  InProcessUiAuditClientOptions,
  PageHandle,
  UiAuditCapture,
  UiAuditCaptureRequest,
  UiAuditOutput,
  UiAuditorProfileOptions,
  UiAuditTask,
  UiAuditViewport,
  UiFinding,
  UiFindingScreenshot,
  UiFindingSeverity,
  UiJudge,
  UiJudgeInput,
  UiJudgeOutput,
  UiJudgeTokenUsage,
  UiLens,
} from './ui-auditor'
export {
  buildAuditorSystemPrompt,
  createInProcessUiAuditClient,
  createUiAuditorValidator,
  decodeAuditTaskEnvelope,
  encodeAuditTaskEnvelope,
  formatAuditorPrompt,
  LENS_BRIEFS,
  parseAuditorEvents,
  SHARED_AUDITOR_RULES,
  UI_FINDING_SEVERITIES,
  UI_LENSES,
  uiAuditorProfile,
} from './ui-auditor'
