/**
 * @experimental
 *
 * `agent-runtime/src/audit` — pure I/O helpers for UI-audit workspaces.
 *
 * The writer lives here (not under `profiles/ui-auditor`) because it is
 * judge-agnostic and browser-agnostic: any consumer with a `UiFinding[]`
 * can persist a workspace, regardless of whether the findings came from
 * the in-process auditor client, a sandbox-SDK harness, or a hand-curated
 * import.
 */

export type {
  AppendFindingsResult,
  AuditIndex,
  AuditRegistry,
  AuditRegistryCapture,
  RegisterCapturesOptions,
} from './issue-writer'
export {
  appendFindings,
  initAuditWorkspace,
  readAuditRegistry,
  registerCaptures,
  summarizeRegistry,
  writeAuditIndex,
} from './issue-writer'
