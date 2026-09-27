//#region src/profiles/ui-auditor/substrate.ts
/** Frozen tuple of lenses for validation + iteration. */
const UI_LENSES = [
	"consistency",
	"hierarchy",
	"layout",
	"ux-flow",
	"duplication",
	"accessibility",
	"responsive",
	"states",
	"content",
	"interaction",
	"performance-perceived",
	"other"
];
/** Frozen severity tuple, ordered worst → least bad for sort/report. */
const UI_FINDING_SEVERITIES = [
	"critical",
	"high",
	"med",
	"low"
];
//#endregion
export { UI_LENSES as n, UI_FINDING_SEVERITIES as t };

//# sourceMappingURL=substrate-B0TYNrXn.js.map