# WebCode E2E dataset (fetched, not vendored)

`code_e2e.jsonl` is the **real** WebCode E2E task set from Exa. It is **not committed** — it carries
secret-shaped test fixtures (one task probes secret detection, so it contains example tokens/keys that trip
GitHub push protection) and is 656K. Fetch it:

```bash
examples/webcode-matrix/data/fetch.sh          # → code_e2e.jsonl (33 tasks)
# or set WEBCODE_DATASET to a code_e2e.jsonl path (e.g. a checkout of exa-labs/benchmarks)
```

- Source: <https://github.com/exa-labs/benchmarks> (`webcode-benchmark/data/e2e/code_e2e.jsonl`, MIT)
- Blog: <https://exa.ai/blog/webcode>
- Schema per row: `{ id, slug, repo, repo_url, release_tag, task_description, test_patch, metadata }`.
  `metadata` carries `citations` (required knowledge), `dockerfile` (the per-task toolchain image), and
  `solution_files` (the file the agent must produce).

Exa ships the dataset **only** — "No agent harness included — bring your own." The harness×model matrix in
`../webcode-matrix.ts` is that harness.
