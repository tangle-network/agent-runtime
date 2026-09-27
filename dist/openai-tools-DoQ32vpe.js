import { c as DELEGATION_HISTORY_TOOL_NAME, f as DELEGATE_FEEDBACK_DESCRIPTION, m as DELEGATE_FEEDBACK_TOOL_NAME, n as DELEGATION_STATUS_INPUT_SCHEMA, o as DELEGATION_HISTORY_DESCRIPTION, p as DELEGATE_FEEDBACK_INPUT_SCHEMA, r as DELEGATION_STATUS_TOOL_NAME, s as DELEGATION_HISTORY_INPUT_SCHEMA, t as DELEGATION_STATUS_DESCRIPTION } from "./delegation-status-CF4D0NZ_.js";
//#region src/mcp/openai-tools.ts
function buildTool(name, description, parameters) {
	return {
		type: "function",
		function: {
			name,
			description,
			parameters: { ...parameters }
		}
	};
}
/**
*
* Returns the queue-bound delegation tools projected into OpenAI Chat
* Completions `tools[]` shape. The order is stable: `delegate_feedback`,
* `delegation_status`, `delegation_history`.
*
* @experimental
*/
function mcpToolsForRuntimeMcp() {
	return [
		buildTool(DELEGATE_FEEDBACK_TOOL_NAME, DELEGATE_FEEDBACK_DESCRIPTION, DELEGATE_FEEDBACK_INPUT_SCHEMA),
		buildTool(DELEGATION_STATUS_TOOL_NAME, DELEGATION_STATUS_DESCRIPTION, DELEGATION_STATUS_INPUT_SCHEMA),
		buildTool(DELEGATION_HISTORY_TOOL_NAME, DELEGATION_HISTORY_DESCRIPTION, DELEGATION_HISTORY_INPUT_SCHEMA)
	];
}
/**
*
* Subset filter — return only the projected tools whose `function.name`
* appears in `names`. Useful for curated mounts (e.g. only the queue-bound
* delegation tools, omitting `delegate_feedback`). Unknown names are
* silently ignored; pass an empty array to get an empty result.
*
* @experimental
*/
function mcpToolsForRuntimeMcpSubset(names) {
	const allowed = new Set(names);
	return mcpToolsForRuntimeMcp().filter((tool) => allowed.has(tool.function.name));
}
//#endregion
export { mcpToolsForRuntimeMcpSubset as n, mcpToolsForRuntimeMcp as t };

//# sourceMappingURL=openai-tools-DoQ32vpe.js.map