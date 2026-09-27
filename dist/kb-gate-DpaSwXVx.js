//#region src/mcp/kb-gate.ts
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Does `value` appear in the (normalized) passage — literally, comma-grouped,
*  or in billion/million shorthand (the forms a source actually writes). */
function valueAppears(value, passageNorm) {
	if (passageNorm.includes(norm(String(value)))) return true;
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	const forms = [value.toLocaleString("en-US")];
	if (Math.abs(value) >= 1e9) forms.push(`${trimZero(value / 1e9)} billion`);
	if (Math.abs(value) >= 1e6) forms.push(`${trimZero(value / 1e6)} million`);
	return forms.some((f) => passageNorm.includes(norm(f)));
}
function trimZero(n) {
	return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
/** The always-on floor judges. Order matters: cheapest / most-fundamental first. */
function builtinJudges(minPassageChars, selfArtifactKinds) {
	const kinds = selfArtifactKinds.map((k) => k.toLowerCase());
	return [
		{
			name: "passage-non-empty",
			judge: (c) => c.verbatimPassage.trim().length >= minPassageChars ? { accept: true } : {
				accept: false,
				reason: `passage shorter than ${minPassageChars} chars`
			}
		},
		{
			name: "passage-present",
			judge: (c) => norm(c.sourceText).includes(norm(c.verbatimPassage)) ? { accept: true } : {
				accept: false,
				reason: "verbatim passage not found in source (unbacked fact)"
			}
		},
		{
			name: "value-in-passage",
			judge: (c) => c.value === void 0 || valueAppears(c.value, norm(c.verbatimPassage)) ? { accept: true } : {
				accept: false,
				reason: `value ${JSON.stringify(c.value)} not present in passage`
			}
		},
		{
			name: "no-circular-citation",
			judge: (c) => {
				if (!c.citation || kinds.length === 0) return { accept: true };
				const cite = c.citation.toLowerCase();
				const hit = kinds.find((k) => cite.includes(k));
				return hit ? {
					accept: false,
					reason: `circular citation to self-generated artifact "${hit}"`
				} : { accept: true };
			}
		}
	];
}
/**
*
* Build a fail-closed KB gate. The returned function runs the built-in floor
* (passage-non-empty → passage-present → value-in-passage → no-circular-citation)
* then any consumer judges, returning on the first veto.
*
* @experimental
*/
function createKbGate(options = {}) {
	const judges = [...builtinJudges(options.minPassageChars ?? 12, options.selfArtifactKinds ?? []), ...options.judges ?? []];
	return async (candidate) => {
		for (const j of judges) {
			const verdict = await j.judge(candidate);
			if (!verdict.accept) return {
				accepted: false,
				vetoedBy: j.name,
				reason: verdict.reason
			};
		}
		return { accepted: true };
	};
}
//#endregion
export { createKbGate as t };

//# sourceMappingURL=kb-gate-DpaSwXVx.js.map