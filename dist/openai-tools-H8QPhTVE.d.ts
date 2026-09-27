import { Ka as OpenAIChatTool } from "./types-D56jQad-.js";
//#region src/mcp/openai-tools.d.ts
/**
 *
 * Returns the queue-bound delegation tools projected into OpenAI Chat
 * Completions `tools[]` shape. The order is stable: `delegate_feedback`,
 * `delegation_status`, `delegation_history`.
 *
 * @experimental
 */
declare function mcpToolsForRuntimeMcp(): OpenAIChatTool[];
/**
 *
 * Subset filter — return only the projected tools whose `function.name`
 * appears in `names`. Useful for curated mounts (e.g. only the queue-bound
 * delegation tools, omitting `delegate_feedback`). Unknown names are
 * silently ignored; pass an empty array to get an empty result.
 *
 * @experimental
 */
declare function mcpToolsForRuntimeMcpSubset(names: ReadonlyArray<string>): OpenAIChatTool[];
//#endregion
export { mcpToolsForRuntimeMcpSubset as n, mcpToolsForRuntimeMcp as t };
//# sourceMappingURL=openai-tools-H8QPhTVE.d.ts.map