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

## agent-builder

Title: Integrate agent-builder with agent-runtime knowledge readiness

`agent-builder` is the meta-platform for creating, testing, deploying, researching, and monetizing domain-specific agents. It already has the strongest production loop among the app repos: Forge builder sims, per-agent scenarios, feedback trajectories, canaries, auto-research, multi-shot optimization, KB optimization, version history, sandbox execution, marketplace publishing, and Playwright-to-agent-eval reporting.

The missing boundary is that generated agents and Forge runs do not yet have a first-class `agent-runtime` preflight. Failures caused by missing build spec context, missing user/business/domain data, unavailable integrations, missing secrets, stale KB evidence, sandbox/runtime gaps, or bad retrieval can still be absorbed as prompt/config failures.

Package updates:

- Upgrade `@tangle-network/agent-eval` from `^0.19.1` to `^0.20.0`.
- Upgrade `@tangle-network/agent-knowledge` from `^1.0.0` to `^1.1.0`.
- Add `@tangle-network/agent-runtime` `^0.2.0`.

Required changes:

- Add a server-side runtime module: `src/lib/.server/runtime/agent-builder-runtime.ts`, `src/lib/.server/runtime/requirements.ts`, and `src/lib/.server/runtime/events.ts`.
- Expose helpers: `buildForgeKnowledgeRequirements(input)`, `buildPublishedAgentKnowledgeRequirements(input)`, `runForgeAgentTask(input)`, `runPublishedAgentTask(input)`, and `runtimeEventsToTraceMetadata(events)`.
- Define Forge build requirements for creator intent, target user, domain/category, BuildSpec completeness and approval, expected artifact, success criteria, tools, integrations, APIs, credentials, secrets, sandbox availability, runtime image, repository/scaffold structure, generated agent config, pricing/marketplace/governance constraints, and user-approved assumptions.
- Define generated-agent requirements for domain-specific user facts, company/business/product context, regulatory freshness, connected integrations, secrets, vault/knowledge pages, source freshness, scenario fixtures, and fallback policy.
- Persist generated-agent runtime metadata with agent config/version metadata so forks and marketplace consumers inherit the right contract.
- Wire `runAgentTask` into Forge builder sims: `src/lib/.server/eval/forge-builder-sim.ts`, `src/routes/api.agents.eval.builder-sim.ts`, and `src/routes/api.admin.builder-sim.run.ts`.
- Wire scenario and eval runs through runtime: `src/routes/api.agents.$agentId.scenarios.run.ts`, `src/routes/api.agents.$agentId.eval.simulate.ts`, `src/routes/api.agents.$agentId.eval.refine.ts`, and `src/routes/api.agents.$agentId.eval.ts`.
- Add readiness checks or metadata to production chat/sandbox chat: `src/routes/api.agents.$agentId.chat.ts`, `src/routes/api.agents.$agentId.sandbox.chat.ts`, and `src/routes/api.v1.agents.$slug.chat.completions.ts`.
- Bridge `agent-knowledge@1.1.0` readiness with `src/routes/api.agents.$agentId.knowledge.index.ts`, `src/routes/api.agents.$agentId.knowledge.search.ts`, `src/routes/api.agents.$agentId.knowledge.discover.ts`, `src/routes/api.agents.$agentId.knowledge.write-blocks.ts`, and `src/lib/.server/kb/optimization.ts`.
- Persist runtime events into trace/report surfaces: `src/lib/.server/eval/trace-store-d1.ts`, `src/lib/.server/eval/session.ts`, `src/lib/.server/eval/run-record-store.ts`, `src/lib/.server/eval/run-record-fields.ts`, and `e2e/reporters/agent-eval-reporter.ts`.
- Preserve `task_start`, `readiness_start/end`, `questions_start/end`, `acquisition_start/end`, `control_start/end`, and `task_end`.
- Report readiness score, blocking gaps, acquisition mode, evidence IDs, user questions, runtime status, and blocked-before-execution status.
- Map failures to `knowledge_readiness_blocked`, `missing_user_data`, `missing_domain_data`, `missing_codebase_context`, `missing_runtime_context`, `missing_credentials`, `stale_external_data`, `bad_retrieval`, `insufficient_evidence`, `contradictory_evidence`, and `ambiguous_user_intent`.
- Update `src/lib/.server/eval/failure-inspector.ts`, `src/lib/.server/eval/multi-shot-adapter.ts`, `src/lib/.server/eval/heuristic-researcher.ts`, `src/lib/.server/eval/auto-research-runner.ts`, and `src/lib/.server/eval/canary-cron.ts`.
- Extend ASI responsible surfaces beyond `agent.config.systemPrompt`: `knowledge-requirements`, `data-acquisition`, `retrieval-policy`, `user-question-policy`, `runtime-environment`, `integration-policy`, `sandbox-policy`, and `agent.config.systemPrompt`.
- Ensure auto-research does not mutate prompts when the dominant failure is missing KB pages, missing BuildSpec fields, missing secrets, unavailable sandbox, or stale evidence.
- Persist runtime contracts across versions, publish, and forks: `src/lib/.server/versions.ts`, `src/routes/api.agents.$agentId.versions.ts`, `src/routes/api.agents.$agentId.versions.$versionId.revert.ts`, `src/routes/api.agents.$agentId.fork.ts`, `src/routes/api.agents.$agentId.fork.apply-update.ts`, and `src/routes/api.agents.$agentId.publish.ts`.
- Add workbench/admin UI visibility for readiness on eval pages, research cycle pages, knowledge pages, chat/workbench blockers, and marketplace/published agent caveats. Do not expose private/secret requirement details to public consumers.

Tests:

- Forge sim blocks when BuildSpec or intent is incomplete.
- Forge sim blocks or asks when required integration credentials are missing.
- Scenario run records readiness metadata.
- KB optimization reports no pages / too few labels as knowledge readiness failures.
- Multi-shot ASI points to data-acquisition/retrieval-policy instead of `agent.config.systemPrompt` for missing knowledge.
- Fork preserves runtime contract.
- Public chat hides private/secret requirement details.
- E2E reporter can include runtime readiness metadata.

Acceptance criteria:

- `agent-builder` depends on `agent-runtime@^0.2.0`, `agent-eval@^0.20.0`, and `agent-knowledge@^1.1.0`.
- Forge builder sims run through `runAgentTask` or a thin typed wrapper.
- Per-agent scenario/eval runs attach `KnowledgeReadinessReport` before execution.
- KB search/optimization feeds readiness into runtime and traces.
- Missing BuildSpec, missing credentials, missing KB pages, stale evidence, bad retrieval, and sandbox unavailability are classified as knowledge/runtime failures.
- Multi-shot optimization can recommend acquisition/retrieval/user-question/runtime-policy changes instead of always mutating prompts.
- Runtime requirements persist across config versions, publish, and fork flows.
- Workbench/admin reports show readiness score, gaps, acquisition plan, runtime status, and blocked-before-execution runs.
