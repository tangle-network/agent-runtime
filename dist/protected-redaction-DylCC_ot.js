import { createHmac, randomBytes } from "node:crypto";
import { REDACTION_VERSION, emptyRedactionReport, redactText } from "@tangle-network/agent-eval/traces";
//#region src/candidate-execution/protected-redaction.ts
/** Create one execution-local namespace for identifiers changed by redaction. */
function createProtectedRecordRedactor(protectedValues) {
	const identityKey = randomBytes(32);
	const aggregate = {
		version: REDACTION_VERSION,
		redactionCount: 0,
		byRule: {}
	};
	const mergeReport = (report) => {
		aggregate.version = report.version;
		aggregate.redactionCount += report.redactionCount;
		for (const [rule, count] of Object.entries(report.byRule)) aggregate.byRule[rule] = (aggregate.byRule[rule] ?? 0) + count;
	};
	const redactScalar = (value, record) => {
		const redacted = redactProtectedValue(value, protectedValues);
		if (record) mergeReport(redacted.report);
		return redacted.value;
	};
	const identifier = (value, record) => {
		const redacted = redactScalar(value, record);
		if (redacted === value) return value;
		return `${redacted}:hmac-sha256:${createHmac("sha256", identityKey).update(value).digest("hex")}`;
	};
	const transform = (value, record) => {
		const transformed = transformProtectedRecord(value, void 0, record, redactScalar, identifier);
		assertNoProtectedEvidence(transformed, protectedValues);
		return transformed;
	};
	return Object.freeze({
		record: (value) => transform(value, true),
		query: (value) => transform(value, false),
		identifier: (value) => identifier(value, false),
		traceIdentity: (trace) => transform(trace, false),
		report: () => ({
			version: aggregate.version,
			redactionCount: aggregate.redactionCount,
			byRule: { ...aggregate.byRule }
		})
	});
}
/** Redact protected values at the first persistence boundary, including object keys and bytes. */
function redactProtectedValue(value, protectedValues) {
	const report = {
		version: REDACTION_VERSION,
		redactionCount: 0,
		byRule: {}
	};
	const redacted = redactNode(value, protectedValues, report);
	assertNoProtectedEvidence(redacted, protectedValues);
	return {
		value: redacted,
		report
	};
}
function redactProtectedReason(reason, protectedValues) {
	try {
		return redactProtectedValue(reason, protectedValues).value;
	} catch {
		return "candidate execution failed with a protected error";
	}
}
function assertNoProtectedEvidence(value, protectedValues) {
	if (value instanceof Uint8Array) {
		assertNoProtectedBytes(value, protectedValues);
		return;
	}
	if (typeof value === "string") {
		for (const protectedValue of protectedValueVariants(protectedValues)) if (value.includes(protectedValue)) throw new Error("protected value survived candidate evidence redaction");
		if (decodedBase64ContainsProtectedValue(value, protectedValues)) throw new Error("base64 protected value survived candidate evidence redaction");
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) assertNoProtectedEvidence(entry, protectedValues);
		return;
	}
	if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
		assertNoProtectedEvidence(key, protectedValues);
		assertNoProtectedEvidence(entry, protectedValues);
	}
}
function assertNoProtectedBytes(bytes, protectedValues) {
	if (containsProtectedBytes(bytes, protectedValues)) throw new Error("protected value survived candidate evidence byte redaction");
}
function redactNode(value, protectedValues, report) {
	if (value instanceof Uint8Array) {
		if (containsProtectedBytes(value, protectedValues)) {
			recordRedaction(report, "candidate-access-binary", 1);
			return Uint8Array.from(Buffer.from("[redacted:candidate-access-binary]", "utf8"));
		}
		return Uint8Array.from(value);
	}
	if (typeof value === "string") {
		if (decodedBase64ContainsProtectedValue(value, protectedValues)) {
			recordRedaction(report, "candidate-access-binary", 1);
			return "[redacted:candidate-access-binary]";
		}
		const core = emptyRedactionReport();
		const redacted = redactText(value, {
			knownSecrets: protectedValues,
			report: core
		});
		for (const [detector, count] of Object.entries(core.byDetector)) recordRedaction(report, detector, count);
		return redacted;
	}
	if (Array.isArray(value)) return value.map((entry) => redactNode(entry, protectedValues, report));
	if (value && typeof value === "object") {
		const entries = [];
		const seenKeys = /* @__PURE__ */ new Set();
		for (const [key, entry] of Object.entries(value)) {
			const redactedKey = redactNode(key, protectedValues, report);
			if (typeof redactedKey !== "string" || seenKeys.has(redactedKey)) throw new Error("protected evidence redaction produced an ambiguous object key");
			seenKeys.add(redactedKey);
			entries.push([redactedKey, redactNode(entry, protectedValues, report)]);
		}
		return Object.fromEntries(entries);
	}
	return value;
}
function transformProtectedRecord(value, fieldName, record, redactScalar, redactIdentifier) {
	if (value instanceof Uint8Array) return redactScalar(value, record);
	if (typeof value === "string") return fieldName && isIdentifierFieldName(fieldName) ? redactIdentifier(value, record) : redactScalar(value, record);
	if (Array.isArray(value)) return value.map((entry) => transformProtectedRecord(entry, fieldName, record, redactScalar, redactIdentifier));
	if (!value || typeof value !== "object") return value;
	if (fieldName === "tags") return transformTagMap(value, record, redactScalar, redactIdentifier);
	if (fieldName === "tag") return transformTagFilter(value, record, redactScalar, redactIdentifier);
	const entries = [];
	const seenKeys = /* @__PURE__ */ new Set();
	for (const [key, entry] of Object.entries(value)) {
		const redactedKey = redactScalar(key, record);
		if (seenKeys.has(redactedKey)) throw new Error("protected evidence redaction produced an ambiguous object key");
		seenKeys.add(redactedKey);
		entries.push([redactedKey, transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier)]);
	}
	return Object.fromEntries(entries);
}
function transformTagMap(value, record, redactScalar, redactIdentifier) {
	const entries = [];
	const seenKeys = /* @__PURE__ */ new Set();
	for (const [key, entry] of Object.entries(value)) {
		const redactedKey = redactIdentifier(key, record);
		if (seenKeys.has(redactedKey)) throw new Error("protected evidence redaction produced an ambiguous trace tag");
		seenKeys.add(redactedKey);
		entries.push([redactedKey, typeof entry === "string" ? redactIdentifier(entry, record) : transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier)]);
	}
	return Object.fromEntries(entries);
}
function transformTagFilter(value, record, redactScalar, redactIdentifier) {
	const output = {};
	for (const [key, entry] of Object.entries(value)) {
		const redactedKey = redactScalar(key, record);
		output[redactedKey] = (key === "key" || key === "value") && typeof entry === "string" ? redactIdentifier(entry, record) : transformProtectedRecord(entry, key, record, redactScalar, redactIdentifier);
	}
	return output;
}
function isIdentifierFieldName(name) {
	return /ids?$/i.test(name);
}
function recordRedaction(report, rule, count) {
	if (count <= 0) return;
	report.redactionCount += count;
	report.byRule[rule] = (report.byRule[rule] ?? 0) + count;
}
function containsProtectedBytes(bytes, protectedValues) {
	const source = Buffer.from(bytes);
	return protectedValueVariants(protectedValues).some((value) => source.includes(Buffer.from(value, "utf8")));
}
function decodedBase64ContainsProtectedValue(value, protectedValues) {
	if (value.length < 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
	try {
		return containsProtectedBytes(Buffer.from(value, "base64"), protectedValues);
	} catch {
		return false;
	}
}
function protectedValueVariants(protectedValues) {
	const variants = /* @__PURE__ */ new Set();
	for (const value of normalizedProtectedValues(protectedValues)) {
		variants.add(value);
		variants.add(Buffer.from(value, "utf8").toString("base64"));
		variants.add(Buffer.from(value, "utf8").toString("base64url"));
		variants.add(encodeURIComponent(value));
	}
	return [...variants];
}
function normalizedProtectedValues(values) {
	return [...new Set(values.filter((value) => value.length > 0))];
}
//#endregion
export { redactProtectedValue as i, createProtectedRecordRedactor as n, redactProtectedReason as r, assertNoProtectedBytes as t };

//# sourceMappingURL=protected-redaction-DylCC_ot.js.map