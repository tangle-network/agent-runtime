[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / profiles

# profiles

**`Experimental`**

Authored `AgentProfile` presets (the §1.5 author-the-profile DATA) for common agent roles, each
with a pure task-to-prompt formatter. The substrate materializes a profile into a harness
invocation; "is it delivered" is a `DeliverableSpec`, not a bundled validator.

## Interfaces

### AuditRegistry

**`Experimental`**

#### Properties

##### schemaVersion

> **schemaVersion**: `1`

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](#uifinding)[]

**`Experimental`**

##### routes

> **routes**: `Record`\<`string`, \{ `url?`: `string`; `captures`: [`AuditRegistryCapture`](#auditregistrycapture)[]; \}\>

**`Experimental`**

Route → URL + captures sidecar; preserved across runs.

***

### AuditRegistryCapture

**`Experimental`**

#### Properties

##### file

> **file**: `string`

**`Experimental`**

##### viewport?

> `optional` **viewport?**: `string`

**`Experimental`**

##### fullPage?

> `optional` **fullPage?**: `boolean`

**`Experimental`**

##### elementSelector?

> `optional` **elementSelector?**: `string`

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

**`Experimental`**

***

### AppendFindingsResult

**`Experimental`**

#### Properties

##### written

> **written**: [`UiFinding`](#uifinding)[]

**`Experimental`**

Findings with id + createdAt assigned, in input order.

##### files

> **files**: `string`[]

**`Experimental`**

Workspace-relative path to each issue Markdown file, in input order.

***

### RegisterCapturesOptions

**`Experimental`**

#### Properties

##### route

> **route**: `string`

**`Experimental`**

##### url?

> `optional` **url?**: `string`

**`Experimental`**

##### captures

> **captures**: readonly [`AuditRegistryCapture`](#auditregistrycapture)[]

**`Experimental`**

***

### AuditIndex

**`Experimental`**

#### Properties

##### total

> **total**: `number`

**`Experimental`**

Total findings in the workspace.

##### bySeverity

> **bySeverity**: `Record`\<[`UiFinding`](#uifinding)\[`"severity"`\], `number`\>

**`Experimental`**

##### byLens

> **byLens**: `Partial`\<`Record`\<[`UiLens`](#uilens), `number`\>\>

**`Experimental`**

##### byRoute

> **byRoute**: `Record`\<`string`, `number`\>

**`Experimental`**

***

### CoderTask

**`Experimental`**

The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces.

#### Properties

##### goal

> **goal**: `string`

**`Experimental`**

What the agent must accomplish. Free-form prose.

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### baseBranch?

> `optional` **baseBranch?**: `string`

**`Experimental`**

Default `main`. The branch the agent diffs against.

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Default `pnpm test --run`.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Default `pnpm typecheck`.

##### contextFiles?

> `optional` **contextFiles?**: `string`[]

**`Experimental`**

Files the agent may inspect for context. Surfaced verbatim in the prompt.

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

Paths the agent must not touch. The mechanical gate hard-fails on any match.
Use glob-free literal path prefixes for unambiguous enforcement.

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

Default 400. Hard cap; the gate hard-fails when exceeded.

***

### ResearchTask

**`Experimental`**

Task contract for a source-grounded research agent.

#### Properties

##### question

> **question**: `string`

**`Experimental`**

The research question to answer.

##### scope?

> `optional` **scope?**: `string`

**`Experimental`**

Bound: e.g. "audience for cpg-founder ICP".

##### knowledgeNamespace

> **knowledgeNamespace**: `string`

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id). Validator enforces.

##### sources?

> `optional` **sources?**: [`ResearchSource`](#researchsource)[]

**`Experimental`**

##### recencyWindow?

> `optional` **recencyWindow?**: `object`

**`Experimental`**

###### since?

> `optional` **since?**: `Date`

###### until?

> `optional` **until?**: `Date`

##### maxItems?

> `optional` **maxItems?**: `number`

**`Experimental`**

##### minConfidence?

> `optional` **minConfidence?**: `number`

**`Experimental`**

Per-item minimum confidence in [0, 1]. Validator scores recall vs this.

***

### KnowledgeItem

**`Experimental`**

Knowledge item emitted by the researcher.

Profile-local type. When agent-knowledge promotes `KnowledgeClaim` →
top-level `KnowledgeItem` substrate-wide, these fields collapse 1:1.

#### Properties

##### id

> **id**: `string`

**`Experimental`**

##### namespace

> **namespace**: `string`

**`Experimental`**

Multi-tenant scope. MUST equal `task.knowledgeNamespace`.

##### claim

> **claim**: `string`

**`Experimental`**

The factual claim, in the researcher's words.

##### evidence

> **evidence**: `object`[]

**`Experimental`**

Provenance — at least one entry required.

###### source

> **source**: `string`

###### quote?

> `optional` **quote?**: `string`

###### url?

> `optional` **url?**: `string`

###### capturedAt

> **capturedAt**: `number`

##### confidence

> **confidence**: `number`

**`Experimental`**

Researcher's self-reported confidence in [0, 1].

##### supersedes?

> `optional` **supersedes?**: `string`[]

**`Experimental`**

Prior item ids this supersedes (chain).

##### retractedAt?

> `optional` **retractedAt?**: `number`

**`Experimental`**

Set if the agent is retracting an earlier item. Unix ms.

##### authoredBy

> **authoredBy**: `object`

**`Experimental`**

###### kind

> **kind**: `"agent"` \| `"human"`

###### id

> **id**: `string`

***

### ResearchOutput

**`Experimental`**

Researcher output. Required fields are typed; optional fields preserve
the agent's free-form intelligence (`notes`, `raw`). The validator
enforces the typed minimum.

#### Properties

##### items

> **items**: [`KnowledgeItem`](#knowledgeitem)[]

**`Experimental`**

##### citations

> **citations**: `object`[]

**`Experimental`**

###### url

> **url**: `string`

###### quote

> **quote**: `string`

###### confidence

> **confidence**: `number`

##### proposedWrites

> **proposedWrites**: [`KnowledgeUpdate`](#knowledgeupdate)[]

**`Experimental`**

##### gaps?

> `optional` **gaps?**: `string`[]

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

**`Experimental`**

##### raw?

> `optional` **raw?**: `unknown`

**`Experimental`**

Anything the agent emitted beyond the typed fields.

***

### ResearcherProfileOptions

**`Experimental`**

Options for the source-grounded researcher profile preset.

#### Properties

##### profile

> **profile**: `AgentProfile`

**`Experimental`**

Caller-owned exact harness/provider/model identity.

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

**`Experimental`**

Custom system prompt replacement. Default = built-in researcher preset.

##### name?

> `optional` **name?**: `string`

**`Experimental`**

Stable name for `AgentRunSpec.name`. Default = `profile.name`.

##### citationDensityMin?

> `optional` **citationDensityMin?**: `number`

**`Experimental`**

Default 0.7. Minimum (citations with quote) / items ratio for `valid=true`.
Below this floor, citation_density scores < 1 and the item set is gated.

***

### MultiHarnessResearcherFanoutOptions

**`Experimental`**

#### Properties

##### profiles

> **profiles**: readonly `AgentProfile`[]

**`Experimental`**

Exact execution profiles, one per parallel researcher.

##### citationDensityMin?

> `optional` **citationDensityMin?**: `number`

**`Experimental`**

Default citation density floor for the shared validator.

##### task?

> `optional` **task?**: [`ResearchTask`](#researchtask)

**`Experimental`**

Optional task — narrows the validator's namespace check.

***

### UiFindingScreenshot

**`Experimental`**

Pointer to a screenshot referenced by a finding (workspace-relative path).

#### Properties

##### path

> **path**: `string`

**`Experimental`**

##### viewport?

> `optional` **viewport?**: `string`

**`Experimental`**

##### label?

> `optional` **label?**: `string`

**`Experimental`**

***

### UiFinding

**`Experimental`**

A single UI audit finding — the unit of work a contributor can act on.

Every field except the documented optionals is required. The auditor
validator + writer hard-fail on missing screenshot evidence, missing
lens, missing title, etc.

#### Properties

##### id?

> `optional` **id?**: `number`

**`Experimental`**

Monotonic id assigned by the writer when persisting. Optional in-transit.

##### title

> **title**: `string`

**`Experimental`**

##### lens

> **lens**: [`UiLens`](#uilens)

**`Experimental`**

##### severity

> **severity**: [`UiFindingSeverity`](#uifindingseverity)

**`Experimental`**

##### route

> **route**: `string`

**`Experimental`**

Logical route the finding was observed on (e.g. `home`, `checkout-step-2`).

##### url?

> `optional` **url?**: `string`

**`Experimental`**

Fully qualified URL the finding was observed at.

##### viewport?

> `optional` **viewport?**: `string`

**`Experimental`**

Viewport string the offending capture was taken at (e.g. `1280x800`).

##### selector?

> `optional` **selector?**: `string`

**`Experimental`**

CSS selector pinning the offending element, when one can be identified.

##### observation

> **observation**: `string`

**`Experimental`**

1–3 sentences describing what the screenshot shows that is wrong.

##### impact

> **impact**: `string`

**`Experimental`**

Who is affected and how.

##### suggestedFix

> **suggestedFix**: `string`

**`Experimental`**

A specific change a contributor could apply without asking back.

##### reproSteps?

> `optional` **reproSteps?**: `string`

**`Experimental`**

Optional explicit reproduction steps. Writer synthesizes from route/url/selector when omitted.

##### tags?

> `optional` **tags?**: readonly `string`[]

**`Experimental`**

Free-form tags.

##### screenshots

> **screenshots**: readonly [`UiFindingScreenshot`](#uifindingscreenshot)[]

**`Experimental`**

Screenshot references — must be non-empty for actionable findings.

##### similarTo?

> `optional` **similarTo?**: readonly `number`[]

**`Experimental`**

Cross-references to similar findings already on file, by id.

##### createdAt?

> `optional` **createdAt?**: `string`

**`Experimental`**

ISO-8601 creation timestamp set by the writer when persisted.

***

### UiAuditViewport

**`Experimental`**

#### Properties

##### width

> **width**: `number`

**`Experimental`**

##### height

> **height**: `number`

**`Experimental`**

***

### UiAuditCaptureRequest

**`Experimental`**

#### Properties

##### route

> **route**: `string`

**`Experimental`**

Logical route name (e.g. `home`, `checkout-step-2`). Used in screenshot
filenames and finding metadata.

##### url

> **url**: `string`

**`Experimental`**

Fully qualified URL the iteration audits.

##### viewport?

> `optional` **viewport?**: [`UiAuditViewport`](#uiauditviewport)

**`Experimental`**

Default `{ width: 1280, height: 800 }`.

##### fullPage?

> `optional` **fullPage?**: `boolean`

**`Experimental`**

Default `false`.

##### waitFor?

> `optional` **waitFor?**: `string`

**`Experimental`**

CSS selector to wait for before capturing.

##### waitMs?

> `optional` **waitMs?**: `number`

**`Experimental`**

Extra milliseconds to wait after navigation settles. Default `500`.

##### elementSelector?

> `optional` **elementSelector?**: `string`

**`Experimental`**

Optional CSS selector — capture only the matched element.

##### label?

> `optional` **label?**: `string`

**`Experimental`**

Optional human-readable label appended to the screenshot filename.

***

### UiAuditTask

**`Experimental`**

One iteration's task: audit a single (lens × route) pair, capturing the
surfaces the lens needs.

`captures` lists the screenshots to take BEFORE the judge is invoked.
The judge sees all captures from this iteration plus the lens-specific
brief.

#### Properties

##### lens

> **lens**: [`UiLens`](#uilens)

**`Experimental`**

The audit lens that scopes which findings are valid this iteration.

##### captures

> **captures**: readonly [`UiAuditCaptureRequest`](#uiauditcapturerequest)[]

**`Experimental`**

Required captures. Order is preserved; index 0 is the primary frame.

##### productContext?

> `optional` **productContext?**: `string`

**`Experimental`**

Free-form context the consumer wants the judge to know about (product
name, target audience, copy tone). Surfaced as a prompt prelude.

##### knownFindingIds?

> `optional` **knownFindingIds?**: readonly `number`[]

**`Experimental`**

IDs of findings already on file across earlier iterations. The judge
uses these to mark cross-references via `similarTo` instead of filing
pile-on duplicates.

***

### UiAuditCapture

**`Experimental`**

#### Properties

##### path

> **path**: `string`

**`Experimental`**

Workspace-relative path to the screenshot file.

##### viewport

> **viewport**: `string`

**`Experimental`**

##### fullPage

> **fullPage**: `boolean`

**`Experimental`**

##### elementSelector?

> `optional` **elementSelector?**: `string`

**`Experimental`**

##### label?

> `optional` **label?**: `string`

**`Experimental`**

##### route

> **route**: `string`

**`Experimental`**

##### url

> **url**: `string`

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

**`Experimental`**

Wall-clock when the capture completed.

***

### UiAuditOutput

**`Experimental`**

Output of one iteration. `findings` is the headline payload; `captures`
is the screenshot manifest the writer needs to link evidence. `notes`
carries judge commentary that didn't rise to a finding.

#### Properties

##### lens

> **lens**: [`UiLens`](#uilens)

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](#uifinding)[]

**`Experimental`**

##### captures

> **captures**: [`UiAuditCapture`](#uiauditcapture)[]

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

**`Experimental`**

Optional judge commentary (debug / triage aid).

## Type Aliases

### ResearchSource

> **ResearchSource** = `"web"` \| `"corpus"` \| `"twitter"` \| `"github"` \| `"docs"`

**`Experimental`**

Source families a researcher profile may prefer for a task.

***

### KnowledgeUpdate

> **KnowledgeUpdate** = \{ `kind`: `"insert"`; `namespace`: `string`; `item`: [`KnowledgeItem`](#knowledgeitem); \} \| \{ `kind`: `"supersede"`; `namespace`: `string`; `previousId`: `string`; `item`: [`KnowledgeItem`](#knowledgeitem); \} \| \{ `kind`: `"retract"`; `namespace`: `string`; `itemId`: `string`; `reason`: `string`; \}

**`Experimental`**

A proposed write to the knowledge base. The profile does NOT apply
these — the caller decides.

***

### UiLens

> **UiLens** = `"consistency"` \| `"hierarchy"` \| `"layout"` \| `"ux-flow"` \| `"duplication"` \| `"accessibility"` \| `"responsive"` \| `"states"` \| `"content"` \| `"interaction"` \| `"performance-perceived"` \| `"other"`

**`Experimental`**

Canonical audit lenses. Each lens scopes a finding to a single class of
problem so a single audit pass can iterate them without pile-on findings
under a generic label.

***

### UiFindingSeverity

> **UiFindingSeverity** = `"low"` \| `"med"` \| `"high"` \| `"critical"`

**`Experimental`**

Severity scale.
  - `critical` — blocks a core task or is an accessibility blocker.
  - `high`     — confusing, broken-looking, or noticeable friction.
  - `med`      — visible polish issue, would be caught in code review.
  - `low`      — nitpick worth fixing eventually.

## Variables

### SHARED\_AUDITOR\_RULES

> `const` **SHARED\_AUDITOR\_RULES**: `string`

**`Experimental`**

Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits.

***

### LENS\_BRIEFS

> `const` **LENS\_BRIEFS**: `Record`\<[`UiLens`](#uilens), `string`\>

**`Experimental`**

Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect.

***

### UI\_LENSES

> `const` **UI\_LENSES**: readonly [`UiLens`](#uilens)[]

**`Experimental`**

Frozen tuple of lenses for validation + iteration.

***

### UI\_FINDING\_SEVERITIES

> `const` **UI\_FINDING\_SEVERITIES**: readonly [`UiFindingSeverity`](#uifindingseverity)[]

**`Experimental`**

Frozen severity tuple, ordered worst → least bad for sort/report.

## Functions

### initAuditWorkspace()

> **initAuditWorkspace**(`workspaceDir`): `Promise`\<`void`\>

**`Experimental`**

Create the `issues/`, `screenshots/`, and `registry.json` scaffold in a new audit workspace.

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<`void`\>

***

### readAuditRegistry()

> **readAuditRegistry**(`workspaceDir`): `Promise`\<[`AuditRegistry`](#auditregistry)\>

**`Experimental`**

Read and validate the `registry.json` from an audit workspace.

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<[`AuditRegistry`](#auditregistry)\>

***

### appendFindings()

> **appendFindings**(`workspaceDir`, `findings`): `Promise`\<[`AppendFindingsResult`](#appendfindingsresult)\>

**`Experimental`**

Append findings to a workspace, writing one Markdown file per finding
and updating registry.json. Assigns monotonically increasing ids to
findings that arrived without one.

Findings already carrying an id that collides with the registry are
rejected — callers must either freshly mint findings (id undefined) or
use a separate update path. This protects against accidental overwrite.

#### Parameters

##### workspaceDir

`string`

##### findings

readonly [`UiFinding`](#uifinding)[]

#### Returns

`Promise`\<[`AppendFindingsResult`](#appendfindingsresult)\>

***

### registerCaptures()

> **registerCaptures**(`workspaceDir`, `options`): `Promise`\<`void`\>

**`Experimental`**

Record screenshots taken for a route in the registry, without filing a
finding. Useful when the auditor wants to remember which captures
exist for resume / dedup purposes.

#### Parameters

##### workspaceDir

`string`

##### options

[`RegisterCapturesOptions`](#registercapturesoptions)

#### Returns

`Promise`\<`void`\>

***

### summarizeRegistry()

> **summarizeRegistry**(`reg`): [`AuditIndex`](#auditindex)

**`Experimental`**

Compute finding counts by severity, lens, and route from an `AuditRegistry`.

#### Parameters

##### reg

[`AuditRegistry`](#auditregistry)

#### Returns

[`AuditIndex`](#auditindex)

***

### writeAuditIndex()

> **writeAuditIndex**(`workspaceDir`): `Promise`\<`string`\>

**`Experimental`**

Regenerate `<workspace>/index.md` from registry.json.

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<`string`\>

***

### coderTaskToPrompt()

> **coderTaskToPrompt**(`task`): `string`

**`Experimental`**

Render a `CoderTask` into the per-task instruction handed to the coder profile.

#### Parameters

##### task

[`CoderTask`](#codertask)

#### Returns

`string`

***

### researcherProfile()

> **researcherProfile**(`options`): `object`

**`Experimental`**

Build a source-grounded researcher profile with output parsing and validation.

#### Parameters

##### options

[`ResearcherProfileOptions`](#researcherprofileoptions) & `object`

#### Returns

`object`

##### profile

> **profile**: `AgentProfile`

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

###### Parameters

###### task

[`ResearchTask`](#researchtask)

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<[`ResearchOutput`](#researchoutput)\>

##### validator

> **validator**: [`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

##### agentRunSpec

> **agentRunSpec**: [`AgentRunSpec`](runtime.md#agentrunspec)\<[`ResearchTask`](#researchtask)\>

***

### multiHarnessResearcherFanout()

> **multiHarnessResearcherFanout**(`options`): `object`

**`Experimental`**

Build a fanout topology over multiple harnesses. The kernel round-robins
`agentRuns` across the N parallel iterations and the `FanoutVote` driver
picks the highest-scoring valid output.

#### Parameters

##### options

[`MultiHarnessResearcherFanoutOptions`](#multiharnessresearcherfanoutoptions)

#### Returns

`object`

##### agentRuns

> **agentRuns**: [`AgentRunSpec`](runtime.md#agentrunspec)\<[`ResearchTask`](#researchtask)\>[]

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<[`ResearchOutput`](#researchoutput)\>

##### validator

> **validator**: [`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

##### driver

> **driver**: [`Driver`](index.md#driver)\<[`ResearchTask`](#researchtask), [`ResearchOutput`](#researchoutput), `"done"`\>

***

### createResearcherValidator()

> **createResearcherValidator**(`task`, `config?`): [`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

**`Experimental`**

Build a validator that closes over a specific `ResearchTask`'s constraints.

Checks in order:
  1. Items must be non-empty.
  2. Every item carries `evidence.length >= 1`.
  3. Every item + proposedWrite is scoped to `task.knowledgeNamespace`
     (hard-fail on any namespace mismatch — defence in depth for the
     multi-tenant invariant).
  4. Citation density (citations with quote / items) >= floor.

Aggregate score:
  0.4 · citation_density
+ 0.2 · source_diversity (distinct sources / max(items, 1))
+ 0.2 · recency_match (mean fraction within `recencyWindow`)
+ 0.2 · (1 − gaps/maxGaps), maxGaps = max(items, 1)

#### Parameters

##### task

[`ResearchTask`](#researchtask)

##### config?

###### citationDensityMin?

`number`

###### namespaceCheck?

`boolean`

#### Returns

[`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

***

### buildAuditorSystemPrompt()

> **buildAuditorSystemPrompt**(`lens`): `string`

**`Experimental`**

Build a system prompt for a single auditor iteration.

#### Parameters

##### lens

[`UiLens`](#uilens)

#### Returns

`string`

***

### parseAuditorEvents()

> **parseAuditorEvents**(`events`): [`UiAuditOutput`](#uiauditoutput)

**`Experimental`**

Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`.

#### Parameters

##### events

`SandboxEvent`[]

#### Returns

[`UiAuditOutput`](#uiauditoutput)

***

### encodeAuditTaskEnvelope()

> **encodeAuditTaskEnvelope**(`task`): `string`

**`Experimental`**

Wrap a `UiAuditTask` in a machine-readable envelope so iterations are self-describing.

#### Parameters

##### task

[`UiAuditTask`](#uiaudittask)

#### Returns

`string`

***

### decodeAuditTaskEnvelope()

> **decodeAuditTaskEnvelope**(`prompt`): [`UiAuditTask`](#uiaudittask) \| `undefined`

**`Experimental`**

Parse a task envelope back out of a prompt string. Returns undefined if
the prompt does not contain a complete envelope OR if the payload is
not valid JSON.

#### Parameters

##### prompt

`string`

#### Returns

[`UiAuditTask`](#uiaudittask) \| `undefined`

***

### formatAuditorPrompt()

> **formatAuditorPrompt**(`task`): `string`

**`Experimental`**

Produce the user message for one audit iteration: lens, captures to take, and the task envelope.

#### Parameters

##### task

[`UiAuditTask`](#uiaudittask)

#### Returns

`string`

***

### createUiAuditorValidator()

> **createUiAuditorValidator**(`task`): [`Validator`](runtime.md#validator-1)\<[`UiAuditOutput`](#uiauditoutput)\>

**`Experimental`**

Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence.

#### Parameters

##### task

[`UiAuditTask`](#uiaudittask)

#### Returns

[`Validator`](runtime.md#validator-1)\<[`UiAuditOutput`](#uiauditoutput)\>
