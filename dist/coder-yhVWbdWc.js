//#region src/profiles/coder.ts
/**
*
* `CoderTask` + `coderTaskToPrompt` — the per-task DATA + pure formatter for code-modification tasks
* (§1.5: the system authors profiles; there is no hardcoded coder profile constant). A domain
* customizes the worker by authoring its own `AgentProfile` and handing it to a leaf executor
* (`createWorktreeCliExecutor`) or a fanout (`worktreeFanout`); "is it delivered" is a
* `DeliverableSpec` (`patchDelivered`), not a bundled validator. This formatter renders a `CoderTask`
* into the per-task instruction that profile receives.
*
* @experimental
*/
const DEFAULT_MAX_DIFF_LINES = 400;
/** Render a `CoderTask` into the per-task instruction handed to the coder profile. @experimental */
function coderTaskToPrompt(task) {
	const base = task.baseBranch ?? "main";
	const testCmd = task.testCmd ?? "pnpm test --run";
	const typecheckCmd = task.typecheckCmd ?? "pnpm typecheck";
	const maxDiff = task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;
	const forbidden = task.forbiddenPaths?.length ? task.forbiddenPaths.join(", ") : "(none)";
	const context = task.contextFiles?.length ? task.contextFiles.map((f) => `  - ${f}`).join("\n") : "  (none)";
	return [
		`Goal: ${task.goal}`,
		`Repo: ${task.repoRoot}`,
		`Base branch: ${base}`,
		`Run tests with: ${testCmd}`,
		`Run typecheck with: ${typecheckCmd}`,
		`Forbidden paths: ${forbidden}`,
		`Max diff lines: ${maxDiff}`,
		"Context files:",
		context,
		"",
		"Produce a minimal patch on a fresh branch. Run tests and typecheck before",
		"returning. Emit the final JSON result block exactly as instructed."
	].join("\n");
}
//#endregion
export { coderTaskToPrompt as t };

//# sourceMappingURL=coder-yhVWbdWc.js.map