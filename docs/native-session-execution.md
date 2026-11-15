# Native session execution

An existing in-place CLI executor can produce a native response envelope with
`outputFormat: 'native-session'`. Runtime still applies the complete AgentProfile with the
shared worktree materializer and runs its existing local subprocess operation. The validated
contract is **OpenCode 2.3.0**. A version probe refuses other versions before inference.

```ts
const executor = {
  backend: 'cli-in-place' as const,
  workspacePath: freshWorkspace,
  outputFormat: 'native-session' as const,
  harnessTimeoutMs: 120_000,
}
const call = profileOptimizerModelCall({ profile, executor, context: 'graph author' })
```

The host owns a fresh workspace and its lifecycle for each independent call. Environment
overrides can select an isolated native configuration/store or an installed executable on PATH.
Runtime pins the child PWD to its actual working directory, selects a private server, fixes a
session title to avoid auxiliary title generation, and captures native JSONL plus the exact
`opencode session export` result. A workspace is not an OS sandbox.

A top-level profile description is carried in the generated primary agent's native frontmatter
without changing its system prompt. Admission verifies that the shared materializer preserved the
exact description, including an explicit empty string. A description without a bound primary
system prompt, or a materializer that omits this field, is refused before native work.

## Identity and usage

The response's `model` is attribution from the native selected route. Its `servedModel` remains
null because the native export records turn context rather than the upstream model response.
Runtime binds the session id, directory, materialized agent and requested variant; verifies the
selected route against the profile; and takes the last completed assistant's text as the response.
The full native records and their digests remain in optimizer execution evidence, including failed
requests. A quota refusal and an unrecognized export cannot become a successful empty answer.

Reported fresh input, cache reads, cache writes, visible output and reasoning remain separate.
Runtime's input total includes both cache classes, while Eval's billing receipt keeps fresh input,
cache reads and cache writes disjoint. Complete usage requires readable, nonzero counters for each
billable assistant/compaction response and reconciliation with the session total. Missing counters,
zero defaults, unattributed work or tools with unqualified child execution leave usage incomplete.
Native cost has no reliable provider-versus-catalog attribution, so billed cost remains unknown.

Successful native skill loads can carry a resource digest only after their path-derived id,
directory and exact rendered content match the bytes Runtime mounted before execution. A matching
skill name or the model's claim that it read a skill is insufficient.

## Bounds and supported requests

For **opencode/glm-5.3-flash-free**, a profile's `maxVisibleOutputTokens` is lowered into the
native model policy before the workspace plan is hashed and applied. The qualified policy emits
`max_tokens` and the terminal native token records are checked for an overrun. This is a visible
token ceiling **per completion**. It does not bound reasoning tokens, the sum of multiple skill/tool
steps, or dollars. Total and reasoning token ceilings remain unsupported; other provider/model
routes requesting this visible ceiling are refused until their wire contract is qualified.

Eval's `maxTokens` request must exactly restate the profile's visible ceiling. It is never silently
omitted or replaced with a post-response-only policy. The host timeout is a real process deadline;
the leaf remains exempt from the conserved live budget because its native session settles after
the subprocess ends.

Ordered chat messages are preserved as one serialized native task. This is a harness task
projection, not a transparent replay of Chat Completions roles. Unsupported request tools, JSON
response modes and model policy overrides still fail before inference.

## Qualification

The maintained integration test `tests/integration/native-opencode-session.test.ts` runs the real
OpenCode executable, complete `graphDesignerProfile` composition, profile materializer, local executor and session export against a loopback
OpenAI-compatible peer. Only the model HTTP response is a fixture. It checks the emitted cap and
tool catalog, ordered message preservation, actual skill loading, native response identity, usage
and retained evidence. Set `OPENCODE_NATIVE_TEST_BIN` to the absolute installed 2.3.0 executable to
run it; an optional `OPENCODE_NATIVE_TEST_EVIDENCE` path retains the request/session receipt.

A skills-only campaign also needs the shared materializer's native wildcard-deny support, with an
explicit allowlist for its mounted skill ids. Legacy false flags for a finite tool list do not
disable new native tools. The loopback qualification is execution-boundary evidence; it is not a
successful free-provider run or evidence that an optimized skill improves task quality. Promotion
must evaluate candidate behavior and any required provider-served identity separately.
