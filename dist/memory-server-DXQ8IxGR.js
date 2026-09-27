import { m as ValidationError } from "./errors-DodWX-cb.js";
import { r as createStdioToolServer } from "./tool-server-Dqer2M4_.js";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
//#region src/mcp/memory-server.ts
/**
* Memory MCP server — the LIVE serving half of the `memory` profile surface
* (Phase 5). A curated memory (lessons distilled from prior runs) is only
* real if the DRIVEN agent can query it mid-task; this module serves a flat
* store of `MemoryItem` rows as `memory_search` / `memory_get` tools over the
* ONE in-repo stdio JSON-RPC core (`createStdioToolServer`), so the exact
* wire protocol the same-host client (`connectStdioMcp` /
* `materializeLocalMcp`, runtime/stdio-mcp-client.ts) speaks is guaranteed by
* construction — serve and consume cannot drift.
*
* Retrieval is DETERMINISTIC lexical overlap (no vectors, no LLM): a lift
* measured with this memory mounted is attributable to the lessons
* themselves, never to retrieval-model noise. Every
* `memory_search` can append one JSONL row to a retrieval log (`logPath`) —
* the per-query record an off-policy retrieval estimator (agent-knowledge's
* `RetrievalHoldout`) consumes. agent-knowledge is NOT a dependency of this
* repo, so the log file is the flagged cross-package seam, not an import.
*
* Fail-loud discipline (mirrors `materializeLocalMcp`): an EMPTY memory is
* never served — a profile without memory simply omits the artifact, and
* silently serving zero rows would fake the with/without ablation.
*
* @experimental
*/
/** Env var naming the durable row store file the memory bin loads (the
*  `memoryMcpServer` ↔ memory-bin contract). */
const MEMORY_FILE_ENV = "AGENT_MEMORY_FILE";
/** Env var carrying inline JSON `MemoryItem` rows (win over file rows on id). */
const MEMORY_ITEMS_ENV = "AGENT_MEMORY_ITEMS";
/** Env var naming the JSONL retrieval log (one row per `memory_search`). */
const MEMORY_LOG_ENV = "AGENT_MEMORY_LOG";
/** Env var overriding the served display name (default 'agent-memory'). */
const MEMORY_NAME_ENV = "AGENT_MEMORY_NAME";
/**
* Build the memory MCP server: `memory_search` (lexical top-k over the rows)
* and `memory_get` (one row by id) on the generic stdio JSON-RPC core.
*/
function createMemoryToolServer(opts) {
	if (opts.items.length === 0) throw new ValidationError("createMemoryToolServer: refusing to serve an EMPTY memory — a profile without memory omits the artifact; serving zero rows would fake the with/without ablation");
	const byId = /* @__PURE__ */ new Map();
	for (const item of opts.items) {
		if (byId.has(item.id)) throw new ValidationError(`createMemoryToolServer: duplicate memory item id '${item.id}'`);
		byId.set(item.id, item);
	}
	const items = [...byId.values()];
	const defaultK = opts.defaultK ?? 5;
	const logPath = opts.logPath;
	if (logPath) mkdirSync(dirname(logPath), { recursive: true });
	const search = {
		name: "memory_search",
		description: "Search the agent memory of lessons learned from prior runs. Give what you are about to do or the problem you face; returns the top-k lessons ranked by relevance. Consult it BEFORE repeating work a prior run already learned from.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "The task/problem at hand — matched against lesson text and tags."
				},
				k: {
					type: "number",
					description: `Max results (default ${defaultK}).`
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Only return items carrying at least one of these tags."
				}
			},
			required: ["query"]
		},
		handler: async (raw) => {
			const args = raw ?? {};
			if (typeof args.query !== "string" || args.query.trim().length === 0) throw new TypeError("memory_search: query must be a non-empty string");
			const k = args.k === void 0 ? defaultK : Math.floor(Number(args.k));
			if (!Number.isFinite(k) || k < 1) throw new TypeError("memory_search: k must be a positive integer");
			let tagFilter;
			if (args.tags !== void 0) {
				if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== "string")) throw new TypeError("memory_search: tags must be an array of strings");
				tagFilter = args.tags;
			}
			const queryTokens = tokenize(args.query);
			const results = (tagFilter ? items.filter((i) => (i.tags ?? []).some((t) => tagFilter.includes(t))) : items).map((item) => ({
				item,
				score: scoreItem(queryTokens, item)
			})).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map(({ item, score }) => ({
				id: item.id,
				text: item.text,
				score: Number(score.toFixed(4)),
				...item.tags ? { tags: item.tags } : {},
				...item.source ? { source: item.source } : {}
			}));
			if (logPath) appendFileSync(logPath, `${JSON.stringify({
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				query: args.query,
				k,
				returned: results.map((r) => ({
					id: r.id,
					score: r.score
				}))
			})}\n`);
			return {
				query: args.query,
				results
			};
		}
	};
	return createStdioToolServer({
		serverName: opts.serverName ?? "agent-memory",
		serverVersion: opts.serverVersion ?? "0",
		tools: [search, {
			name: "memory_get",
			description: "Fetch one memory item verbatim by its id (ids come from memory_search results).",
			inputSchema: {
				type: "object",
				properties: { id: {
					type: "string",
					description: "The memory item id."
				} },
				required: ["id"]
			},
			handler: async (raw) => {
				const args = raw ?? {};
				if (typeof args.id !== "string" || args.id.trim().length === 0) throw new TypeError("memory_get: id must be a non-empty string");
				const item = byId.get(args.id);
				if (!item) throw new Error(`memory_get: no memory item with id '${args.id}'`);
				return item;
			}
		}]
	});
}
/** Coerce an untrusted JSON array into validated `MemoryItem` rows. */
function parseMemoryItems(value, source) {
	if (!Array.isArray(value)) throw new ValidationError(`${source}: expected a JSON array of memory items`);
	return value.map((row, i) => coerceMemoryItem(row, `${source}[${i}]`));
}
/** Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line). */
function readMemoryItemsFile(path) {
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new ValidationError(`readMemoryItemsFile: cannot read '${path}': ${err instanceof Error ? err.message : String(err)}`);
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) return [];
	if (trimmed.startsWith("[")) {
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch (err) {
			throw new ValidationError(`readMemoryItemsFile: '${path}' is not valid JSON: ${err.message}`);
		}
		return parseMemoryItems(parsed, path);
	}
	return trimmed.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line, i) => {
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			throw new ValidationError(`readMemoryItemsFile: '${path}' line ${i + 1} is not valid JSON: ${err.message}`);
		}
		return coerceMemoryItem(parsed, `${path}:${i + 1}`);
	});
}
/**
* Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or
* `AGENT_MEMORY_ITEMS` (inline JSON rows; wins on id collision). Zero rows is
* a boot FAILURE, matching the fail-closed materialization discipline.
*/
function resolveMemoryFromEnv(env) {
	const filePath = env[MEMORY_FILE_ENV];
	const inlineRaw = env[MEMORY_ITEMS_ENV];
	const fromFile = filePath ? readMemoryItemsFile(filePath) : [];
	let inline = [];
	if (inlineRaw) {
		let parsed;
		try {
			parsed = JSON.parse(inlineRaw);
		} catch (err) {
			throw new ValidationError(`${MEMORY_ITEMS_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
		}
		inline = parseMemoryItems(parsed, MEMORY_ITEMS_ENV);
	}
	const byId = /* @__PURE__ */ new Map();
	for (const item of fromFile) byId.set(item.id, item);
	for (const item of inline) byId.set(item.id, item);
	if (byId.size === 0) throw new ValidationError(`memory bin: no memory items — set ${MEMORY_FILE_ENV} and/or ${MEMORY_ITEMS_ENV}; an EMPTY memory must never be served (a profile without memory omits the artifact)`);
	const serverName = env[MEMORY_NAME_ENV];
	const logPath = env[MEMORY_LOG_ENV];
	return {
		items: [...byId.values()],
		...serverName ? { serverName } : {},
		...logPath ? { logPath } : {}
	};
}
function coerceMemoryItem(row, at) {
	if (!row || typeof row !== "object" || Array.isArray(row)) throw new ValidationError(`${at}: memory item must be an object`);
	const r = row;
	if (typeof r.id !== "string" || r.id.trim().length === 0) throw new ValidationError(`${at}: 'id' must be a non-empty string`);
	if (typeof r.text !== "string" || r.text.trim().length === 0) throw new ValidationError(`${at}: 'text' must be a non-empty string`);
	let tags;
	if (r.tags !== void 0) {
		if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== "string")) throw new ValidationError(`${at}: 'tags' must be an array of strings`);
		tags = r.tags;
	}
	if (r.source !== void 0 && typeof r.source !== "string") throw new ValidationError(`${at}: 'source' must be a string`);
	return {
		id: r.id,
		text: r.text,
		...tags ? { tags } : {},
		...typeof r.source === "string" ? { source: r.source } : {}
	};
}
/** Unique lowercase alphanumeric tokens of length >= 2. */
function tokenize(text) {
	return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];
}
/** Fraction of query tokens present in the item's text + tags (0..1). */
function scoreItem(queryTokens, item) {
	if (queryTokens.length === 0) return 0;
	const hay = new Set(tokenize(`${item.text} ${(item.tags ?? []).join(" ")}`));
	let hit = 0;
	for (const t of queryTokens) if (hay.has(t)) hit += 1;
	return hit / queryTokens.length;
}
//#endregion
export { createMemoryToolServer as a, resolveMemoryFromEnv as c, MEMORY_NAME_ENV as i, MEMORY_ITEMS_ENV as n, parseMemoryItems as o, MEMORY_LOG_ENV as r, readMemoryItemsFile as s, MEMORY_FILE_ENV as t };

//# sourceMappingURL=memory-server-DXQ8IxGR.js.map