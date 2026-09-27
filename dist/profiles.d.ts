import { Ca as Validator } from "./types-D56jQad-.js";
import { _ as CoderTask, a as UiFindingSeverity, c as KnowledgeUpdate, d as ResearchSource, f as ResearchTask, g as researcherProfile, h as multiHarnessResearcherFanout, i as UiFindingScreenshot, l as MultiHarnessResearcherFanoutOptions, m as createResearcherValidator, n as UI_LENSES, o as UiLens, p as ResearcherProfileOptions, r as UiFinding, s as KnowledgeItem, t as UI_FINDING_SEVERITIES, u as ResearchOutput, v as coderTaskToPrompt } from "./substrate-CHQ5GYnU.js";
import { SandboxEvent } from "@tangle-network/sandbox";
//#region src/audit/issue-writer.d.ts
/** @experimental */
interface AuditRegistry {
  schemaVersion: 1;
  findings: UiFinding[];
  /** Route → URL + captures sidecar; preserved across runs. */
  routes: Record<string, {
    url?: string;
    captures: AuditRegistryCapture[];
  }>;
}
/** @experimental */
interface AuditRegistryCapture {
  file: string;
  viewport?: string;
  fullPage?: boolean;
  elementSelector?: string;
  capturedAt: string;
}
/** Create the `issues/`, `screenshots/`, and `registry.json` scaffold in a new audit workspace. @experimental */
declare function initAuditWorkspace(workspaceDir: string): Promise<void>;
/** Read and validate the `registry.json` from an audit workspace. @experimental */
declare function readAuditRegistry(workspaceDir: string): Promise<AuditRegistry>;
/** @experimental */
interface AppendFindingsResult {
  /** Findings with id + createdAt assigned, in input order. */
  written: UiFinding[];
  /** Workspace-relative path to each issue Markdown file, in input order. */
  files: string[];
}
/**
 * Append findings to a workspace, writing one Markdown file per finding
 * and updating registry.json. Assigns monotonically increasing ids to
 * findings that arrived without one.
 *
 * Findings already carrying an id that collides with the registry are
 * rejected — callers must either freshly mint findings (id undefined) or
 * use a separate update path. This protects against accidental overwrite.
 *
 * @experimental
 */
declare function appendFindings(workspaceDir: string, findings: readonly UiFinding[]): Promise<AppendFindingsResult>;
/** @experimental */
interface RegisterCapturesOptions {
  route: string;
  url?: string;
  captures: readonly AuditRegistryCapture[];
}
/**
 * Record screenshots taken for a route in the registry, without filing a
 * finding. Useful when the auditor wants to remember which captures
 * exist for resume / dedup purposes.
 *
 * @experimental
 */
declare function registerCaptures(workspaceDir: string, options: RegisterCapturesOptions): Promise<void>;
/** @experimental */
interface AuditIndex {
  /** Total findings in the workspace. */
  total: number;
  bySeverity: Record<UiFinding['severity'], number>;
  byLens: Partial<Record<UiLens, number>>;
  byRoute: Record<string, number>;
}
/** Compute finding counts by severity, lens, and route from an `AuditRegistry`. @experimental */
declare function summarizeRegistry(reg: AuditRegistry): AuditIndex;
/**
 * Regenerate `<workspace>/index.md` from registry.json.
 *
 * @experimental
 */
declare function writeAuditIndex(workspaceDir: string): Promise<string>;
//#endregion
//#region src/profiles/ui-auditor/lens-prompts.d.ts
/** Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits. @experimental */
declare const SHARED_AUDITOR_RULES: string;
/** Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect. @experimental */
declare const LENS_BRIEFS: Record<UiLens, string>;
/**
 * Build a system prompt for a single auditor iteration.
 *
 * @experimental
 */
declare function buildAuditorSystemPrompt(lens: UiLens): string;
//#endregion
//#region src/profiles/ui-auditor/task.d.ts
/** @experimental */
interface UiAuditViewport {
  width: number;
  height: number;
}
/** @experimental */
interface UiAuditCaptureRequest {
  /**
   * Logical route name (e.g. `home`, `checkout-step-2`). Used in screenshot
   * filenames and finding metadata.
   */
  route: string;
  /** Fully qualified URL the iteration audits. */
  url: string;
  /** Default `{ width: 1280, height: 800 }`. */
  viewport?: UiAuditViewport;
  /** Default `false`. */
  fullPage?: boolean;
  /** CSS selector to wait for before capturing. */
  waitFor?: string;
  /** Extra milliseconds to wait after navigation settles. Default `500`. */
  waitMs?: number;
  /** Optional CSS selector — capture only the matched element. */
  elementSelector?: string;
  /** Optional human-readable label appended to the screenshot filename. */
  label?: string;
}
/**
 * One iteration's task: audit a single (lens × route) pair, capturing the
 * surfaces the lens needs.
 *
 * `captures` lists the screenshots to take BEFORE the judge is invoked.
 * The judge sees all captures from this iteration plus the lens-specific
 * brief.
 *
 * @experimental
 */
interface UiAuditTask {
  /** The audit lens that scopes which findings are valid this iteration. */
  lens: UiLens;
  /** Required captures. Order is preserved; index 0 is the primary frame. */
  captures: readonly UiAuditCaptureRequest[];
  /**
   * Free-form context the consumer wants the judge to know about (product
   * name, target audience, copy tone). Surfaced as a prompt prelude.
   */
  productContext?: string;
  /**
   * IDs of findings already on file across earlier iterations. The judge
   * uses these to mark cross-references via `similarTo` instead of filing
   * pile-on duplicates.
   */
  knownFindingIds?: readonly number[];
}
/** @experimental */
interface UiAuditCapture {
  /** Workspace-relative path to the screenshot file. */
  path: string;
  viewport: string;
  fullPage: boolean;
  elementSelector?: string;
  label?: string;
  route: string;
  url: string;
  /** Wall-clock when the capture completed. */
  capturedAt: string;
}
/**
 * Output of one iteration. `findings` is the headline payload; `captures`
 * is the screenshot manifest the writer needs to link evidence. `notes`
 * carries judge commentary that didn't rise to a finding.
 *
 * @experimental
 */
interface UiAuditOutput {
  lens: UiLens;
  findings: UiFinding[];
  captures: UiAuditCapture[];
  /** Optional judge commentary (debug / triage aid). */
  notes?: string;
}
//#endregion
//#region src/profiles/ui-auditor/output-adapter.d.ts
/** Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`. @experimental */
declare function parseAuditorEvents(events: SandboxEvent[]): UiAuditOutput;
//#endregion
//#region src/profiles/ui-auditor/prompt.d.ts
/** Wrap a `UiAuditTask` in a machine-readable envelope so iterations are self-describing. @experimental */
declare function encodeAuditTaskEnvelope(task: UiAuditTask): string;
/**
 * Parse a task envelope back out of a prompt string. Returns undefined if
 * the prompt does not contain a complete envelope OR if the payload is
 * not valid JSON.
 *
 * @experimental
 */
declare function decodeAuditTaskEnvelope(prompt: string): UiAuditTask | undefined;
/** Produce the user message for one audit iteration: lens, captures to take, and the task envelope. @experimental */
declare function formatAuditorPrompt(task: UiAuditTask): string;
//#endregion
//#region src/profiles/ui-auditor/validator.d.ts
/** Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence. @experimental */
declare function createUiAuditorValidator(task: UiAuditTask): Validator<UiAuditOutput>;
//#endregion
export { type AppendFindingsResult, type AuditIndex, type AuditRegistry, type AuditRegistryCapture, type CoderTask, type KnowledgeItem, type KnowledgeUpdate, LENS_BRIEFS, type MultiHarnessResearcherFanoutOptions, type RegisterCapturesOptions, type ResearchOutput, type ResearchSource, type ResearchTask, type ResearcherProfileOptions, SHARED_AUDITOR_RULES, UI_FINDING_SEVERITIES, UI_LENSES, type UiAuditCapture, type UiAuditCaptureRequest, type UiAuditOutput, type UiAuditTask, type UiAuditViewport, type UiFinding, type UiFindingScreenshot, type UiFindingSeverity, type UiLens, appendFindings, buildAuditorSystemPrompt, coderTaskToPrompt, createResearcherValidator, createUiAuditorValidator, decodeAuditTaskEnvelope, encodeAuditTaskEnvelope, formatAuditorPrompt, initAuditWorkspace, multiHarnessResearcherFanout, parseAuditorEvents, readAuditRegistry, registerCaptures, researcherProfile, summarizeRegistry, writeAuditIndex };
//# sourceMappingURL=profiles.d.ts.map