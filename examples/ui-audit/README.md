# ui-audit

`uiAuditorProfile()` + `createInProcessUiAuditClient()` + `runLoop()` + the issue-Markdown writer — the smallest end-to-end UI audit.

The example uses a **stub judge** so it runs without an API key and demonstrates the wiring. For production, replace `stubJudge` with a real vision LLM call.

## What the example shows

- A custom `LoopSandboxClient` — the in-process browser+judge client — satisfies the kernel contract WITHOUT a real sandbox-SDK harness. The kernel does `client.create() → box.streamPrompt() → box.delete()` exactly as it does for `coderProfile`; the work happens in-process.
- A custom `Driver` (`lensCyclingDriver`) plans one iteration per lens in a fixed order. Swap for `createRefineDriver` or `createDynamicDriver` for richer topologies.
- `appendFindings(workspaceDir, findings)` and `writeAuditIndex(workspaceDir)` persist self-contained GitHub-issue Markdown files plus a registry + index.

## Run

```bash
pnpm dlx tsx examples/ui-audit/ui-audit.ts /tmp/ui-audit-demo https://example.com
```

If you omit the workspace path, the example writes to a temp dir. The screenshots and `issues/NNN--<lens>--<slug>.md` files are self-contained — you can `gh issue create --body-file <file>` them straight into GitHub.

## Production wiring

Replace `stubJudge` with the real perception seam. The judge owns the vision LLM call (OpenAI, Anthropic, gemini, local model — anything that accepts images + a prompt and returns structured findings). The auditor handles capture + Markdown emission; the judge owns judgment.
