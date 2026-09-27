import { m as ValidationError } from "./errors-DodWX-cb.js";
import { createInterface } from "node:readline";
//#region src/mcp/tool-server.ts
/**
* `createStdioToolServer` — the generic newline-delimited JSON-RPC 2.0 MCP
* server core: `initialize` / `notifications/initialized` / `tools/list` /
* `ping` / `tools/call` over a stdio-shaped transport. It answers the
* client's protocol version when listed in `SUPPORTED_PROTOCOL_VERSIONS`,
* else 2024-11-05, and publishes tool annotations when a tool declares them.
*
* Extracted from `createMcpServer` (server.ts) so every in-repo MCP server —
* the delegation server, the memory server — serves the ONE wire protocol the
* same-host client (`connectStdioMcp`, runtime/stdio-mcp-client.ts) speaks.
* A second hand-rolled serve loop could drift from what the client expects;
* this core makes that impossible by construction.
*
* @experimental
*/
const PROTOCOL_VERSION = "2024-11-05";
/**
* Protocol versions this server speaks, newest first. `initialize` answers with
* the client's requested version when it is listed here, and otherwise with
* `PROTOCOL_VERSION` (2024-11-05), which every client that speaks 2024-11-05 accepts.
*/
const SUPPORTED_PROTOCOL_VERSIONS = [
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
	PROTOCOL_VERSION
];
/** Build the generic stdio JSON-RPC tool server. */
function createStdioToolServer(options) {
	const tools = /* @__PURE__ */ new Map();
	for (const tool of options.tools) {
		if (tools.has(tool.name)) throw new ValidationError(`createStdioToolServer: duplicate tool name "${tool.name}"`);
		tools.set(tool.name, tool);
	}
	let stopped = false;
	let activeReadline;
	async function handle(message) {
		if (stopped) return rpcError(message.id ?? null, -32099, "server stopped");
		if (message.method === "initialize") {
			const requested = message.params?.protocolVersion;
			return rpcResult(message.id ?? null, {
				protocolVersion: typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: {
					name: options.serverName,
					version: options.serverVersion
				}
			});
		}
		if (message.method === "notifications/initialized") return null;
		if (message.method === "ping") return rpcResult(message.id ?? null, {});
		if (message.method === "tools/list") return rpcResult(message.id ?? null, { tools: [...tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			...tool.annotations ? { annotations: tool.annotations } : {}
		})) });
		if (message.method === "tools/call") {
			const params = message.params ?? {};
			const name = typeof params.name === "string" ? params.name : "";
			const tool = tools.get(name);
			if (!tool) return rpcError(message.id ?? null, -32601, `unknown tool: ${name}`);
			try {
				const output = await tool.handler(params.arguments ?? {});
				return rpcResult(message.id ?? null, toolCallResult(output));
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				const code = err instanceof TypeError || err instanceof RangeError ? -32602 : -32e3;
				return rpcError(message.id ?? null, code, reason);
			}
		}
		if (message.id === void 0 || message.id === null) return null;
		return rpcError(message.id, -32601, `unknown method: ${message.method}`);
	}
	async function serve(transport) {
		const input = transport?.input ?? process.stdin;
		const output = transport?.output ?? process.stdout;
		const rl = createInterface({
			input,
			crlfDelay: Number.POSITIVE_INFINITY
		});
		activeReadline = rl;
		return new Promise((resolve, reject) => {
			rl.on("line", (line) => {
				const trimmed = line.trim();
				if (!trimmed) return;
				let parsed;
				try {
					parsed = JSON.parse(trimmed);
				} catch (err) {
					writeResponse(output, rpcError(null, -32700, `parse error: ${err.message}`));
					return;
				}
				if (parsed?.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
					writeResponse(output, rpcError(parsed?.id ?? null, -32600, "invalid request"));
					return;
				}
				handle(parsed).then((response) => {
					if (response) writeResponse(output, response);
				});
			});
			rl.on("close", () => resolve());
			rl.on("error", (err) => reject(err));
			if (stopped) {
				rl.close();
				resolve();
			}
		});
	}
	function stop() {
		stopped = true;
		activeReadline?.close();
		activeReadline = void 0;
	}
	return {
		tools,
		handle,
		serve,
		stop
	};
}
function toolCallResult(output) {
	let json;
	try {
		json = JSON.stringify(output);
	} catch (err) {
		const reason = err instanceof Error ? `: ${err.message}` : "";
		throw new TypeError(`MCP tool result must be JSON-serializable${reason}`, { cause: err });
	}
	if (json === void 0) throw new TypeError("MCP tool result must be JSON-serializable");
	const serialized = JSON.parse(json);
	const result = {
		content: [{
			type: "text",
			text: typeof serialized === "string" ? serialized : json
		}],
		isError: false
	};
	if (serialized !== null && typeof serialized === "object" && !Array.isArray(serialized)) result.structuredContent = serialized;
	return result;
}
function rpcResult(id, result) {
	return {
		jsonrpc: "2.0",
		id,
		result
	};
}
function rpcError(id, code, message, data) {
	return {
		jsonrpc: "2.0",
		id,
		error: data === void 0 ? {
			code,
			message
		} : {
			code,
			message,
			data
		}
	};
}
function writeResponse(output, response) {
	output.write(`${JSON.stringify(response)}\n`);
}
//#endregion
export { SUPPORTED_PROTOCOL_VERSIONS as n, createStdioToolServer as r, PROTOCOL_VERSION as t };

//# sourceMappingURL=tool-server-Dqer2M4_.js.map