import { C as canonicalCandidateDigest$1, D as immutableCandidateValue, O as omitTopLevelDigest } from "./workspace-archive-C9lgf77y.js";
import { agentCandidateBundleSchema } from "@tangle-network/agent-interface";
//#region src/candidate-execution/bundle.ts
/** Validate and content-address a candidate bundle before it crosses an approval boundary. */
function sealAgentCandidateBundle(input) {
	const digest = canonicalCandidateDigest$1(input);
	const parsed = agentCandidateBundleSchema.parse({
		...input,
		digest
	});
	if (canonicalCandidateDigest$1(omitTopLevelDigest(parsed)) !== digest) throw new Error("candidate bundle changed while validating its canonical wire shape");
	return immutableCandidateValue(parsed);
}
//#endregion
export { sealAgentCandidateBundle as t };

//# sourceMappingURL=bundle-CvLGRVO-.js.map