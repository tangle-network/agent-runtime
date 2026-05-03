# Domain Agent Runtime Integration Issues

GitHub issue creation was blocked in this environment: the GitHub connector returns 404 for the private repos and `gh` is not authenticated. These are the issue drafts to open once repository credentials are available.

## tax-agent

Title: Integrate tax evals with agent-runtime knowledge readiness

`@tangle-network/agent-runtime@0.2.0` provides the shared task harness for domain agents: `runAgentTask`, typed runtime events, `KnowledgeRequirement`, readiness scoring, question/acquisition preflight hooks, and integration with `@tangle-network/agent-eval@0.20.0`.

First local implementation:

- Bump root `@tangle-network/agent-eval` to `0.20.0`.
- Add root `@tangle-network/agent-runtime` `^0.2.0`.
- Bump `server` `@tangle-network/agent-eval` to `0.20.0`.
- Add `tests/eval/lib/agent-runtime.ts` with `buildTaxKnowledgeRequirements()` and `runTaxAgentTask()`.
- Add `tests/eval/lib/agent-runtime.test.ts` covering missing-context blocking and ready-context execution.

Remaining changes:

- Wire the runtime helper into `tests/eval/lib/deterministic-tax-workflow-runner.ts`, `tests/eval/harness/run-product-eval.ts`, `tests/eval/harness/run-workspace-eval.ts`, `tests/eval/optimize.ts`, `tests/eval/lib/agent-eval-runtime.ts`, and `tests/eval/lib/trace-sync.ts`.
- Canonicalize tax requirements for taxpayer facts, filing year, jurisdiction, source documents, workflow tools, entity classification, elections, accounting method, book/tax reconciliation, payroll, withholding, estimated payments, credits, nexus, apportionment, OCR confidence, current authority, and user-confirmed assumptions.
- Persist runtime events into traces: `task_start`, `readiness_start/end`, `questions_start/end`, `acquisition_start/end`, `control_start/end`, and `task_end`.
- Report readiness score, blocking gaps, acquisition mode, evidence IDs, blocked-before-execution status, and optimizer responsible surface.
- Classify missing documents, missing jurisdiction, stale authority, bad retrieval, insufficient evidence, contradictory evidence, missing credentials, and ambiguous taxpayer intent as knowledge failures rather than prompt failures.
- Feed gaps into multi-shot optimization as `knowledge-requirements`, `data-acquisition`, `retrieval-policy`, or `user-question-policy`.
- Add tests for missing taxpayer facts, missing documents, missing jurisdiction, stale authority, and fully ready execution.

## legal-agent

Title: Integrate legal evals with agent-runtime knowledge readiness

First local implementation:

- Bump `@tangle-network/agent-eval` dev dependency to `^0.20.0`.
- Add `@tangle-network/agent-runtime` dev dependency `^0.2.0`.
- Add `tests/eval/lib/agent-runtime.ts` with `buildLegalKnowledgeRequirements()` and `runLegalAgentTask()`.
- Add `tests/eval/lib/agent-runtime.test.ts` covering missing matter context and ready execution.

Remaining changes:

- Wire `runLegalAgentTask()` into `tests/eval/harness/run-product-eval.ts`, `tests/eval/harness/run-dual-agent-eval.ts`, `tests/eval/optimize.ts`, `tests/eval/lib/agent-eval-runtime.ts`, and `tests/eval/lib/trace-sync.ts`.
- Canonicalize legal requirements for matter facts, parties, dates, jurisdiction, forum, venue, governing law, current authority, uploaded matter documents, knowledge-base search, client credentials, regulated industry constraints, deadlines, and user-approved assumptions.
- Enforce knowledge-base retrieval before drafting or review, with retrieval evidence saved into the runtime bundle.
- Persist runtime readiness metadata and events into trace sync and eval reports.
- Classify missing facts, missing authority, stale law, bad retrieval, insufficient evidence, contradictory authority, missing credentials, and ambiguous user intent as knowledge failures.
- Extend optimization ASI rows so legal reports recommend data acquisition or authority refresh before prompt rewrites.
- Add tests for missing jurisdiction, stale authority, missing knowledge-base results, contradictory authority, and ready document review.

## gtm-agent

Title: Integrate GTM evals with agent-runtime knowledge readiness

First local implementation:

- Bump `@tangle-network/agent-eval` to `0.20.0`.
- Add `@tangle-network/agent-runtime` `^0.2.0`.
- Add `eval/agent-runtime.ts` with `buildGtmKnowledgeRequirements()` and `runGtmAgentTask()`.
- Add `tests/agent-runtime.test.ts` covering missing company/connector context and ready execution.

Remaining changes:

- Wire `runGtmAgentTask()` into `eval/business-owner/live-flow.ts`, `eval/discover-brief/run.ts`, `eval/run.ts`, `eval/agent-eval-traces.ts`, and optimizer flows.
- Canonicalize GTM requirements for company profile, product/offer, ICP/personas, channel history, CRM state, campaign history, analytics, performance metrics, positioning, competitors, integrations, credentials, and workspace vault knowledge.
- Turn `knowledge/wiki/company.md`, `products.md`, `channels.md`, and `open-questions.md` into runtime evidence inputs.
- Persist readiness events into existing trace helpers and reports.
- Classify missing company data, missing market data, stale metrics, missing credentials, bad connector retrieval, insufficient evidence, contradictory positioning, and ambiguous business-owner intent as knowledge failures.
- Feed knowledge gaps into optimization as data-acquisition/retrieval-policy/user-question-policy issues.
- Add tests for missing ICP, missing product context, missing connectors, stale metrics, and ready discover-brief execution.

## creative-agent

Title: Integrate creative evals with agent-runtime knowledge readiness

First local implementation:

- Bump `@tangle-network/agent-eval` to `^0.20.0`.
- Add `@tangle-network/agent-runtime` `^0.2.0`.
- Add `eval/control/agent-runtime.ts` with `buildCreativeKnowledgeRequirements()` and `runCreativeAgentTask()`.
- Add `tests/agent-runtime.test.ts` covering missing creative intent/rights and ready execution.

Remaining changes:

- Wire `runCreativeAgentTask()` into `eval/control/creative-onboarding.ts`, `eval/control/creative-workflow-optimization.ts`, `eval/control/creative-multishot-optimization.ts`, `eval/e2e/creative-product-harness.ts`, and trace/report code.
- Canonicalize creative requirements for intent, audience, taste thesis, references, dislikes, brand system, source rights, generated asset policy, deliverable specs, channel constraints, localization, approval policy, feedback source, and revision budget.
- Convert onboarding answers and approval feedback into runtime evidence and reusable knowledge requirements.
- Persist readiness events in control/e2e traces and reports.
- Classify missing creative intent, missing taste signal, missing brand assets, missing rights, stale source policy, bad asset retrieval, insufficient evidence, contradictory feedback, and ambiguous user intent as knowledge failures.
- Feed approval/readiness gaps into multi-shot optimization as data or policy surfaces before prompt changes.
- Add tests for missing intent, missing rights, missing approval policy, contradictory feedback, and ready workflow execution.

## blueprint-agent

Title: Integrate Blueprint benchmarks with agent-runtime knowledge readiness

No implementation was requested for this pass. The repo should adopt the runtime boundary before deeper report polish so benchmark failures separate missing task-world knowledge from coding-agent failures.

Remaining changes:

- Add `@tangle-network/agent-runtime` to the workspace package(s) that own benchmark execution.
- Keep existing benchmark database/report terms stable if they still say `vertical`; map to runtime `domain` metadata instead of forcing a broad rename.
- Define Blueprint requirements for task brief, repo/source checkout, package manager, framework/language, build command, test command, sandbox availability, runtime environment, credentials/secrets, Tangle Blueprint SDK docs, template/plugin docs, deploy target, and benchmark scoring contract.
- Wrap the benchmark product path with `runAgentTask` so readiness is scored before agent execution.
- Persist runtime events into agent-eval traces and `bench-report`.
- Add readiness sections to markdown/HTML/JSON reports: requirement table, missing evidence, acquisition plan, blocked-before-execution runs, and readiness deltas by run/version.
- Map failures to `knowledge_readiness_blocked`, `missing_codebase_context`, `missing_runtime_context`, `missing_credentials`, `stale_external_data`, `bad_retrieval`, `insufficient_evidence`, `contradictory_evidence`, `reasoning_error`, `tool_selection_error`, `sandbox_failure`, and `budget_exceeded`.
- Extend holdout/promotion gates so a prompt/topology change is not promoted when observed gain is actually due to different context acquisition.
- Add tests for missing build command, missing SDK docs, missing sandbox, stale template docs, and fully ready benchmark execution.
