[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / profiles

# profiles

## Interfaces

### AuditRegistry

Defined in: src/audit/issue-writer.ts:31

**`Experimental`**

#### Properties

##### schemaVersion

> **schemaVersion**: `1`

Defined in: src/audit/issue-writer.ts:32

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](#uifinding)[]

Defined in: src/audit/issue-writer.ts:33

**`Experimental`**

##### routes

> **routes**: `Record`\<`string`, \{ `url?`: `string`; `captures`: [`AuditRegistryCapture`](#auditregistrycapture)[]; \}\>

Defined in: src/audit/issue-writer.ts:35

**`Experimental`**

Route → URL + captures sidecar; preserved across runs.

***

### AuditRegistryCapture

Defined in: src/audit/issue-writer.ts:39

**`Experimental`**

#### Properties

##### file

> **file**: `string`

Defined in: src/audit/issue-writer.ts:40

**`Experimental`**

##### viewport?

> `optional` **viewport?**: `string`

Defined in: src/audit/issue-writer.ts:41

**`Experimental`**

##### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: src/audit/issue-writer.ts:42

**`Experimental`**

##### elementSelector?

> `optional` **elementSelector?**: `string`

Defined in: src/audit/issue-writer.ts:43

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: src/audit/issue-writer.ts:44

**`Experimental`**

***

### AppendFindingsResult

Defined in: src/audit/issue-writer.ts:255

**`Experimental`**

#### Properties

##### written

> **written**: [`UiFinding`](#uifinding)[]

Defined in: src/audit/issue-writer.ts:257

**`Experimental`**

Findings with id + createdAt assigned, in input order.

##### files

> **files**: `string`[]

Defined in: src/audit/issue-writer.ts:259

**`Experimental`**

Workspace-relative path to each issue Markdown file, in input order.

***

### RegisterCapturesOptions

Defined in: src/audit/issue-writer.ts:337

**`Experimental`**

#### Properties

##### route

> **route**: `string`

Defined in: src/audit/issue-writer.ts:338

**`Experimental`**

##### url?

> `optional` **url?**: `string`

Defined in: src/audit/issue-writer.ts:339

**`Experimental`**

##### captures

> **captures**: readonly [`AuditRegistryCapture`](#auditregistrycapture)[]

Defined in: src/audit/issue-writer.ts:340

**`Experimental`**

***

### AuditIndex

Defined in: src/audit/issue-writer.ts:370

**`Experimental`**

#### Properties

##### total

> **total**: `number`

Defined in: src/audit/issue-writer.ts:372

**`Experimental`**

Total findings in the workspace.

##### bySeverity

> **bySeverity**: `Record`\<[`UiFinding`](#uifinding)\[`"severity"`\], `number`\>

Defined in: src/audit/issue-writer.ts:373

**`Experimental`**

##### byLens

> **byLens**: `Partial`\<`Record`\<[`UiLens`](#uilens), `number`\>\>

Defined in: src/audit/issue-writer.ts:374

**`Experimental`**

##### byRoute

> **byRoute**: `Record`\<`string`, `number`\>

Defined in: src/audit/issue-writer.ts:375

**`Experimental`**

***

### CoderTask

Defined in: src/profiles/coder.ts:16

**`Experimental`**

The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces.

#### Properties

##### goal

> **goal**: `string`

Defined in: src/profiles/coder.ts:18

**`Experimental`**

What the agent must accomplish. Free-form prose.

##### repoRoot

> **repoRoot**: `string`

Defined in: src/profiles/coder.ts:20

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### baseBranch?

> `optional` **baseBranch?**: `string`

Defined in: src/profiles/coder.ts:22

**`Experimental`**

Default `main`. The branch the agent diffs against.

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: src/profiles/coder.ts:24

**`Experimental`**

Default `pnpm test --run`.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: src/profiles/coder.ts:26

**`Experimental`**

Default `pnpm typecheck`.

##### contextFiles?

> `optional` **contextFiles?**: `string`[]

Defined in: src/profiles/coder.ts:28

**`Experimental`**

Files the agent may inspect for context. Surfaced verbatim in the prompt.

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: src/profiles/coder.ts:33

**`Experimental`**

Paths the agent must not touch. The mechanical gate hard-fails on any match.
Use glob-free literal path prefixes for unambiguous enforcement.

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: src/profiles/coder.ts:35

**`Experimental`**

Default 400. Hard cap; the gate hard-fails when exceeded.

***

### ResearchTask

Defined in: src/profiles/researcher.ts:40

**`Experimental`**

Task contract for a source-grounded research agent.

#### Properties

##### question

> **question**: `string`

Defined in: src/profiles/researcher.ts:42

**`Experimental`**

The research question to answer.

##### scope?

> `optional` **scope?**: `string`

Defined in: src/profiles/researcher.ts:44

**`Experimental`**

Bound: e.g. "audience for cpg-founder ICP".

##### knowledgeNamespace

> **knowledgeNamespace**: `string`

Defined in: src/profiles/researcher.ts:46

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id). Validator enforces.

##### sources?

> `optional` **sources?**: [`ResearchSource`](#researchsource)[]

Defined in: src/profiles/researcher.ts:47

**`Experimental`**

##### recencyWindow?

> `optional` **recencyWindow?**: `object`

Defined in: src/profiles/researcher.ts:48

**`Experimental`**

###### since?

> `optional` **since?**: `Date`

###### until?

> `optional` **until?**: `Date`

##### maxItems?

> `optional` **maxItems?**: `number`

Defined in: src/profiles/researcher.ts:49

**`Experimental`**

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: src/profiles/researcher.ts:51

**`Experimental`**

Per-item minimum confidence in [0, 1]. Validator scores recall vs this.

***

### KnowledgeItem

Defined in: src/profiles/researcher.ts:62

**`Experimental`**

Knowledge item emitted by the researcher.

Profile-local type. When agent-knowledge promotes `KnowledgeClaim` →
top-level `KnowledgeItem` substrate-wide, these fields collapse 1:1.

#### Properties

##### id

> **id**: `string`

Defined in: src/profiles/researcher.ts:63

**`Experimental`**

##### namespace

> **namespace**: `string`

Defined in: src/profiles/researcher.ts:65

**`Experimental`**

Multi-tenant scope. MUST equal `task.knowledgeNamespace`.

##### claim

> **claim**: `string`

Defined in: src/profiles/researcher.ts:67

**`Experimental`**

The factual claim, in the researcher's words.

##### evidence

> **evidence**: `object`[]

Defined in: src/profiles/researcher.ts:69

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

Defined in: src/profiles/researcher.ts:71

**`Experimental`**

Researcher's self-reported confidence in [0, 1].

##### supersedes?

> `optional` **supersedes?**: `string`[]

Defined in: src/profiles/researcher.ts:73

**`Experimental`**

Prior item ids this supersedes (chain).

##### retractedAt?

> `optional` **retractedAt?**: `number`

Defined in: src/profiles/researcher.ts:75

**`Experimental`**

Set if the agent is retracting an earlier item. Unix ms.

##### authoredBy

> **authoredBy**: `object`

Defined in: src/profiles/researcher.ts:76

**`Experimental`**

###### kind

> **kind**: `"agent"` \| `"human"`

###### id

> **id**: `string`

***

### ResearchOutput

Defined in: src/profiles/researcher.ts:97

**`Experimental`**

Researcher output. Required fields are typed; optional fields preserve
the agent's free-form intelligence (`notes`, `raw`). The validator
enforces the typed minimum.

#### Properties

##### items

> **items**: [`KnowledgeItem`](#knowledgeitem)[]

Defined in: src/profiles/researcher.ts:98

**`Experimental`**

##### citations

> **citations**: `object`[]

Defined in: src/profiles/researcher.ts:99

**`Experimental`**

###### url

> **url**: `string`

###### quote

> **quote**: `string`

###### confidence

> **confidence**: `number`

##### proposedWrites

> **proposedWrites**: [`KnowledgeUpdate`](#knowledgeupdate)[]

Defined in: src/profiles/researcher.ts:100

**`Experimental`**

##### gaps?

> `optional` **gaps?**: `string`[]

Defined in: src/profiles/researcher.ts:101

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

Defined in: src/profiles/researcher.ts:102

**`Experimental`**

##### raw?

> `optional` **raw?**: `unknown`

Defined in: src/profiles/researcher.ts:104

**`Experimental`**

Anything the agent emitted beyond the typed fields.

***

### ResearcherProfileOptions

Defined in: src/profiles/researcher.ts:108

**`Experimental`**

Options for the source-grounded researcher profile preset.

#### Properties

##### harness?

> `optional` **harness?**: `string`

Defined in: src/profiles/researcher.ts:110

**`Experimental`**

Sandbox-SDK backend.type. Default `'opencode/zai-coding-plan/glm-5.1'`.

##### model?

> `optional` **model?**: `string`

Defined in: src/profiles/researcher.ts:112

**`Experimental`**

Default model id passed in `AgentProfile.model.default`.

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: src/profiles/researcher.ts:114

**`Experimental`**

Custom system prompt replacement. Default = built-in researcher preset.

##### name?

> `optional` **name?**: `string`

Defined in: src/profiles/researcher.ts:116

**`Experimental`**

Stable name for `AgentRunSpec.name`. Default = `researcher-${harness}`.

##### citationDensityMin?

> `optional` **citationDensityMin?**: `number`

Defined in: src/profiles/researcher.ts:121

**`Experimental`**

Default 0.7. Minimum (citations with quote) / items ratio for `valid=true`.
Below this floor, citation_density scores < 1 and the item set is gated.

***

### MultiHarnessResearcherFanoutOptions

Defined in: src/profiles/researcher.ts:165

**`Experimental`**

#### Properties

##### harnesses?

> `optional` **harnesses?**: `string`[]

Defined in: src/profiles/researcher.ts:167

**`Experimental`**

Backend.type identifiers, one per parallel agent.

##### models?

> `optional` **models?**: (`string` \| `undefined`)[]

Defined in: src/profiles/researcher.ts:169

**`Experimental`**

Optional per-harness model override. Indexed parallel to `harnesses`.

##### citationDensityMin?

> `optional` **citationDensityMin?**: `number`

Defined in: src/profiles/researcher.ts:171

**`Experimental`**

Default citation density floor for the shared validator.

##### task?

> `optional` **task?**: [`ResearchTask`](#researchtask)

Defined in: src/profiles/researcher.ts:173

**`Experimental`**

Optional task — narrows the validator's namespace check.

***

### InProcessUiAuditClientOptions

Defined in: src/profiles/ui-auditor/in-process-client.ts:46

**`Experimental`**

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

Defined in: src/profiles/ui-auditor/in-process-client.ts:52

**`Experimental`**

Absolute path under which screenshots are written. Each capture lands
at `<workspaceDir>/screenshots/<filename>`; finding screenshot paths
are workspace-relative (`screenshots/<filename>`).

##### judge

> **judge**: [`UiJudge`](#uijudge)

Defined in: src/profiles/ui-auditor/in-process-client.ts:54

**`Experimental`**

The vision judge that turns captures into findings.

##### navPolicy?

> `optional` **navPolicy?**: `"strict"` \| `"spa"`

Defined in: src/profiles/ui-auditor/in-process-client.ts:63

**`Experimental`**

Navigation policy.

`'strict'` (default) waits for `networkidle` and fails the iteration
if the page does not settle. `'spa'` waits for `domcontentloaded` —
use for single-page apps that hold open long-poll/websocket
connections and never settle.

##### launchBrowser?

> `optional` **launchBrowser?**: () => `Promise`\<[`BrowserHandle`](#browserhandle)\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:69

**`Experimental`**

Browser launch override. Default: chromium headless via Playwright.
Consumers pass a custom factory to target a remote browser, a
different channel, or a fleet adapter.

###### Returns

`Promise`\<[`BrowserHandle`](#browserhandle)\>

***

### BrowserHandle

Defined in: src/profiles/ui-auditor/in-process-client.ts:73

**`Experimental`**

#### Methods

##### newContext()

> **newContext**(`options?`): `Promise`\<[`BrowserContextHandle`](#browsercontexthandle)\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:74

**`Experimental`**

###### Parameters

###### options?

###### viewport?

\{ `width`: `number`; `height`: `number`; \}

###### viewport.width

`number`

###### viewport.height

`number`

###### Returns

`Promise`\<[`BrowserContextHandle`](#browsercontexthandle)\>

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:77

**`Experimental`**

###### Returns

`Promise`\<`void`\>

***

### BrowserContextHandle

Defined in: src/profiles/ui-auditor/in-process-client.ts:81

**`Experimental`**

#### Methods

##### newPage()

> **newPage**(): `Promise`\<[`PageHandle`](#pagehandle)\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:82

**`Experimental`**

###### Returns

`Promise`\<[`PageHandle`](#pagehandle)\>

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:83

**`Experimental`**

###### Returns

`Promise`\<`void`\>

***

### PageHandle

Defined in: src/profiles/ui-auditor/in-process-client.ts:87

**`Experimental`**

#### Methods

##### setViewportSize()

> **setViewportSize**(`size`): `Promise`\<`void`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:88

**`Experimental`**

###### Parameters

###### size

###### width

`number`

###### height

`number`

###### Returns

`Promise`\<`void`\>

##### goto()

> **goto**(`url`, `options?`): `Promise`\<`unknown`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:89

**`Experimental`**

###### Parameters

###### url

`string`

###### options?

###### waitUntil?

`string`

###### timeout?

`number`

###### Returns

`Promise`\<`unknown`\>

##### waitForSelector()

> **waitForSelector**(`selector`, `options?`): `Promise`\<`unknown`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:90

**`Experimental`**

###### Parameters

###### selector

`string`

###### options?

###### timeout?

`number`

###### Returns

`Promise`\<`unknown`\>

##### waitForTimeout()

> **waitForTimeout**(`ms`): `Promise`\<`void`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:91

**`Experimental`**

###### Parameters

###### ms

`number`

###### Returns

`Promise`\<`void`\>

##### screenshot()

> **screenshot**(`options`): `Promise`\<`void`\>

Defined in: src/profiles/ui-auditor/in-process-client.ts:92

**`Experimental`**

###### Parameters

###### options

###### path

`string`

###### fullPage?

`boolean`

###### Returns

`Promise`\<`void`\>

##### locator()

> **locator**(`selector`): `object`

Defined in: src/profiles/ui-auditor/in-process-client.ts:93

**`Experimental`**

###### Parameters

###### selector

`string`

###### Returns

`object`

###### first()

> **first**(): `object`

###### Returns

`object`

###### screenshot()

> **screenshot**(`options`): `Promise`\<`void`\>

###### Parameters

###### options

###### path

`string`

###### Returns

`Promise`\<`void`\>

***

### UiJudgeTokenUsage

Defined in: src/profiles/ui-auditor/judge.ts:31

**`Experimental`**

#### Properties

##### input

> **input**: `number`

Defined in: src/profiles/ui-auditor/judge.ts:32

**`Experimental`**

##### output

> **output**: `number`

Defined in: src/profiles/ui-auditor/judge.ts:33

**`Experimental`**

***

### UiJudgeInput

Defined in: src/profiles/ui-auditor/judge.ts:37

**`Experimental`**

#### Properties

##### lens

> **lens**: [`UiLens`](#uilens)

Defined in: src/profiles/ui-auditor/judge.ts:38

**`Experimental`**

##### captures

> **captures**: readonly [`UiAuditCapture`](#uiauditcapture)[]

Defined in: src/profiles/ui-auditor/judge.ts:39

**`Experimental`**

##### productContext?

> `optional` **productContext?**: `string`

Defined in: src/profiles/ui-auditor/judge.ts:41

**`Experimental`**

Free-form product context the consumer wants the judge to know.

##### knownFindingIds?

> `optional` **knownFindingIds?**: readonly `number`[]

Defined in: src/profiles/ui-auditor/judge.ts:43

**`Experimental`**

Findings already on file across earlier iterations — for similarTo linkage.

##### promptText

> **promptText**: `string`

Defined in: src/profiles/ui-auditor/judge.ts:45

**`Experimental`**

The full prompt the loop kernel synthesized for this iteration.

##### signal

> **signal**: `AbortSignal`

Defined in: src/profiles/ui-auditor/judge.ts:47

**`Experimental`**

Cooperative cancellation.

***

### UiJudgeOutput

Defined in: src/profiles/ui-auditor/judge.ts:51

**`Experimental`**

#### Properties

##### findings

> **findings**: [`UiFinding`](#uifinding)[]

Defined in: src/profiles/ui-auditor/judge.ts:52

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

Defined in: src/profiles/ui-auditor/judge.ts:54

**`Experimental`**

Optional triage commentary.

##### tokenUsage?

> `optional` **tokenUsage?**: [`UiJudgeTokenUsage`](#uijudgetokenusage)

Defined in: src/profiles/ui-auditor/judge.ts:56

**`Experimental`**

Optional usage; folded into the kernel cost ledger when present.

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: src/profiles/ui-auditor/judge.ts:58

**`Experimental`**

Optional total cost in USD.

***

### UiAuditorProfileOptions

Defined in: src/profiles/ui-auditor/profile.ts:23

**`Experimental`**

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: src/profiles/ui-auditor/profile.ts:27

**`Experimental`**

Stable name surfaced in trace events. Defaults to `ui-auditor`.

##### model?

> `optional` **model?**: `string`

Defined in: src/profiles/ui-auditor/profile.ts:32

**`Experimental`**

Optional model identifier passed in `AgentProfile.model.default`.
The consumer's `SandboxClient` chooses how to interpret it.

##### task?

> `optional` **task?**: [`UiAuditTask`](#uiaudittask)

Defined in: src/profiles/ui-auditor/profile.ts:38

**`Experimental`**

Task bound to the validator. Without it the validator uses the lens
embedded in the iteration output as its expectation — fine for one-off
use; less strict than passing the task explicitly.

***

### UiFindingScreenshot

Defined in: src/profiles/ui-auditor/substrate.ts:69

Pointer to a screenshot referenced by a finding (workspace-relative path).

#### Properties

##### path

> **path**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:70

##### viewport?

> `optional` **viewport?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:71

##### label?

> `optional` **label?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:72

***

### UiFinding

Defined in: src/profiles/ui-auditor/substrate.ts:82

A single UI audit finding — the unit of work a contributor can act on.

Every field except the documented optionals is required. The auditor
validator + writer hard-fail on missing screenshot evidence, missing
lens, missing title, etc.

#### Properties

##### id?

> `optional` **id?**: `number`

Defined in: src/profiles/ui-auditor/substrate.ts:84

Monotonic id assigned by the writer when persisting. Optional in-transit.

##### title

> **title**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:85

##### lens

> **lens**: [`UiLens`](#uilens)

Defined in: src/profiles/ui-auditor/substrate.ts:86

##### severity

> **severity**: [`UiFindingSeverity`](#uifindingseverity)

Defined in: src/profiles/ui-auditor/substrate.ts:87

##### route

> **route**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:89

Logical route the finding was observed on (e.g. `home`, `checkout-step-2`).

##### url?

> `optional` **url?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:91

Fully qualified URL the finding was observed at.

##### viewport?

> `optional` **viewport?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:93

Viewport string the offending capture was taken at (e.g. `1280x800`).

##### selector?

> `optional` **selector?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:95

CSS selector pinning the offending element, when one can be identified.

##### observation

> **observation**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:97

1–3 sentences describing what the screenshot shows that is wrong.

##### impact

> **impact**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:99

Who is affected and how.

##### suggestedFix

> **suggestedFix**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:101

A specific change a contributor could apply without asking back.

##### reproSteps?

> `optional` **reproSteps?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:103

Optional explicit reproduction steps. Writer synthesizes from route/url/selector when omitted.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: src/profiles/ui-auditor/substrate.ts:105

Free-form tags.

##### screenshots

> **screenshots**: readonly [`UiFindingScreenshot`](#uifindingscreenshot)[]

Defined in: src/profiles/ui-auditor/substrate.ts:107

Screenshot references — must be non-empty for actionable findings.

##### similarTo?

> `optional` **similarTo?**: readonly `number`[]

Defined in: src/profiles/ui-auditor/substrate.ts:109

Cross-references to similar findings already on file, by id.

##### createdAt?

> `optional` **createdAt?**: `string`

Defined in: src/profiles/ui-auditor/substrate.ts:111

ISO-8601 creation timestamp set by the writer when persisted.

***

### UiAuditViewport

Defined in: src/profiles/ui-auditor/task.ts:17

**`Experimental`**

#### Properties

##### width

> **width**: `number`

Defined in: src/profiles/ui-auditor/task.ts:18

**`Experimental`**

##### height

> **height**: `number`

Defined in: src/profiles/ui-auditor/task.ts:19

**`Experimental`**

***

### UiAuditCaptureRequest

Defined in: src/profiles/ui-auditor/task.ts:23

**`Experimental`**

#### Properties

##### route

> **route**: `string`

Defined in: src/profiles/ui-auditor/task.ts:28

**`Experimental`**

Logical route name (e.g. `home`, `checkout-step-2`). Used in screenshot
filenames and finding metadata.

##### url

> **url**: `string`

Defined in: src/profiles/ui-auditor/task.ts:30

**`Experimental`**

Fully qualified URL the iteration audits.

##### viewport?

> `optional` **viewport?**: [`UiAuditViewport`](#uiauditviewport)

Defined in: src/profiles/ui-auditor/task.ts:32

**`Experimental`**

Default `{ width: 1280, height: 800 }`.

##### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: src/profiles/ui-auditor/task.ts:34

**`Experimental`**

Default `false`.

##### waitFor?

> `optional` **waitFor?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:36

**`Experimental`**

CSS selector to wait for before capturing.

##### waitMs?

> `optional` **waitMs?**: `number`

Defined in: src/profiles/ui-auditor/task.ts:38

**`Experimental`**

Extra milliseconds to wait after navigation settles. Default `500`.

##### elementSelector?

> `optional` **elementSelector?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:40

**`Experimental`**

Optional CSS selector — capture only the matched element.

##### label?

> `optional` **label?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:42

**`Experimental`**

Optional human-readable label appended to the screenshot filename.

***

### UiAuditTask

Defined in: src/profiles/ui-auditor/task.ts:55

**`Experimental`**

One iteration's task: audit a single (lens × route) pair, capturing the
surfaces the lens needs.

`captures` lists the screenshots to take BEFORE the judge is invoked.
The judge sees all captures from this iteration plus the lens-specific
brief.

#### Properties

##### lens

> **lens**: [`UiLens`](#uilens)

Defined in: src/profiles/ui-auditor/task.ts:57

**`Experimental`**

The audit lens that scopes which findings are valid this iteration.

##### captures

> **captures**: readonly [`UiAuditCaptureRequest`](#uiauditcapturerequest)[]

Defined in: src/profiles/ui-auditor/task.ts:59

**`Experimental`**

Required captures. Order is preserved; index 0 is the primary frame.

##### productContext?

> `optional` **productContext?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:64

**`Experimental`**

Free-form context the consumer wants the judge to know about (product
name, target audience, copy tone). Surfaced as a prompt prelude.

##### knownFindingIds?

> `optional` **knownFindingIds?**: readonly `number`[]

Defined in: src/profiles/ui-auditor/task.ts:70

**`Experimental`**

IDs of findings already on file across earlier iterations. The judge
uses these to mark cross-references via `similarTo` instead of filing
pile-on duplicates.

***

### UiAuditCapture

Defined in: src/profiles/ui-auditor/task.ts:74

**`Experimental`**

#### Properties

##### path

> **path**: `string`

Defined in: src/profiles/ui-auditor/task.ts:76

**`Experimental`**

Workspace-relative path to the screenshot file.

##### viewport

> **viewport**: `string`

Defined in: src/profiles/ui-auditor/task.ts:77

**`Experimental`**

##### fullPage

> **fullPage**: `boolean`

Defined in: src/profiles/ui-auditor/task.ts:78

**`Experimental`**

##### elementSelector?

> `optional` **elementSelector?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:79

**`Experimental`**

##### label?

> `optional` **label?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:80

**`Experimental`**

##### route

> **route**: `string`

Defined in: src/profiles/ui-auditor/task.ts:81

**`Experimental`**

##### url

> **url**: `string`

Defined in: src/profiles/ui-auditor/task.ts:82

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: src/profiles/ui-auditor/task.ts:84

**`Experimental`**

Wall-clock when the capture completed.

***

### UiAuditOutput

Defined in: src/profiles/ui-auditor/task.ts:94

**`Experimental`**

Output of one iteration. `findings` is the headline payload; `captures`
is the screenshot manifest the writer needs to link evidence. `notes`
carries judge commentary that didn't rise to a finding.

#### Properties

##### lens

> **lens**: [`UiLens`](#uilens)

Defined in: src/profiles/ui-auditor/task.ts:95

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](#uifinding)[]

Defined in: src/profiles/ui-auditor/task.ts:96

**`Experimental`**

##### captures

> **captures**: [`UiAuditCapture`](#uiauditcapture)[]

Defined in: src/profiles/ui-auditor/task.ts:97

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

Defined in: src/profiles/ui-auditor/task.ts:99

**`Experimental`**

Optional judge commentary (debug / triage aid).

## Type Aliases

### ResearchSource

> **ResearchSource** = `"web"` \| `"corpus"` \| `"twitter"` \| `"github"` \| `"docs"`

Defined in: src/profiles/researcher.ts:37

**`Experimental`**

Source families a researcher profile may prefer for a task.

***

### KnowledgeUpdate

> **KnowledgeUpdate** = \{ `kind`: `"insert"`; `namespace`: `string`; `item`: [`KnowledgeItem`](#knowledgeitem); \} \| \{ `kind`: `"supersede"`; `namespace`: `string`; `previousId`: `string`; `item`: [`KnowledgeItem`](#knowledgeitem); \} \| \{ `kind`: `"retract"`; `namespace`: `string`; `itemId`: `string`; `reason`: `string`; \}

Defined in: src/profiles/researcher.ts:85

**`Experimental`**

A proposed write to the knowledge base. The profile does NOT apply
these — the caller decides.

***

### UiJudge

> **UiJudge** = (`input`) => `Promise`\<[`UiJudgeOutput`](#uijudgeoutput)\>

Defined in: src/profiles/ui-auditor/judge.ts:62

**`Experimental`**

#### Parameters

##### input

[`UiJudgeInput`](#uijudgeinput)

#### Returns

`Promise`\<[`UiJudgeOutput`](#uijudgeoutput)\>

***

### UiLens

> **UiLens** = `"consistency"` \| `"hierarchy"` \| `"layout"` \| `"ux-flow"` \| `"duplication"` \| `"accessibility"` \| `"responsive"` \| `"states"` \| `"content"` \| `"interaction"` \| `"performance-perceived"` \| `"other"`

Defined in: src/profiles/ui-auditor/substrate.ts:21

Canonical audit lenses. Each lens scopes a finding to a single class of
problem so a single audit pass can iterate them without pile-on findings
under a generic label.

***

### UiFindingSeverity

> **UiFindingSeverity** = `"low"` \| `"med"` \| `"high"` \| `"critical"`

Defined in: src/profiles/ui-auditor/substrate.ts:58

Severity scale.
  - `critical` — blocks a core task or is an accessibility blocker.
  - `high`     — confusing, broken-looking, or noticeable friction.
  - `med`      — visible polish issue, would be caught in code review.
  - `low`      — nitpick worth fixing eventually.

## Variables

### SHARED\_AUDITOR\_RULES

> `const` **SHARED\_AUDITOR\_RULES**: `string`

Defined in: src/profiles/ui-auditor/lens-prompts.ts:18

**`Experimental`**

Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits.

***

### LENS\_BRIEFS

> `const` **LENS\_BRIEFS**: `Record`\<[`UiLens`](#uilens), `string`\>

Defined in: src/profiles/ui-auditor/lens-prompts.ts:40

**`Experimental`**

Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect.

***

### UI\_LENSES

> `const` **UI\_LENSES**: readonly [`UiLens`](#uilens)[]

Defined in: src/profiles/ui-auditor/substrate.ts:36

Frozen tuple of lenses for validation + iteration.

***

### UI\_FINDING\_SEVERITIES

> `const` **UI\_FINDING\_SEVERITIES**: readonly [`UiFindingSeverity`](#uifindingseverity)[]

Defined in: src/profiles/ui-auditor/substrate.ts:61

Frozen severity tuple, ordered worst → least bad for sort/report.

## Functions

### initAuditWorkspace()

> **initAuditWorkspace**(`workspaceDir`): `Promise`\<`void`\>

Defined in: src/audit/issue-writer.ts:79

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

Defined in: src/audit/issue-writer.ts:93

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

Defined in: src/audit/issue-writer.ts:273

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

Defined in: src/audit/issue-writer.ts:350

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

Defined in: src/audit/issue-writer.ts:379

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

Defined in: src/audit/issue-writer.ts:401

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

Defined in: src/profiles/coder.ts:39

**`Experimental`**

Render a `CoderTask` into the per-task instruction handed to the coder profile.

#### Parameters

##### task

[`CoderTask`](#codertask)

#### Returns

`string`

***

### researcherProfile()

> **researcherProfile**(`options?`): `object`

Defined in: src/profiles/researcher.ts:128

**`Experimental`**

Build a source-grounded researcher profile with output parsing and validation.

#### Parameters

##### options?

[`ResearcherProfileOptions`](#researcherprofileoptions) & `object` = `{}`

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

> **multiHarnessResearcherFanout**(`options?`): `object`

Defined in: src/profiles/researcher.ts:183

**`Experimental`**

Build a fanout topology over multiple harnesses. The kernel round-robins
`agentRuns` across the N parallel iterations and the `FanoutVote` driver
picks the highest-scoring valid output.

#### Parameters

##### options?

[`MultiHarnessResearcherFanoutOptions`](#multiharnessresearcherfanoutoptions) = `{}`

#### Returns

`object`

##### agentRuns

> **agentRuns**: [`AgentRunSpec`](runtime.md#agentrunspec)\<[`ResearchTask`](#researchtask)\>[]

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<[`ResearchOutput`](#researchoutput)\>

##### validator

> **validator**: [`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

##### driver

> **driver**: [`Driver`](runtime.md#driver-2)\<[`ResearchTask`](#researchtask), [`ResearchOutput`](#researchoutput), `"done"`\>

***

### createResearcherValidator()

> **createResearcherValidator**(`task`, `config?`): [`Validator`](runtime.md#validator-1)\<[`ResearchOutput`](#researchoutput)\>

Defined in: src/profiles/researcher.ts:241

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

### createInProcessUiAuditClient()

> **createInProcessUiAuditClient**(`options`): [`SandboxClient`](runtime.md#sandboxclient-5) & `object`

Defined in: src/profiles/ui-auditor/in-process-client.ts:190

**`Experimental`**

Create a `SandboxClient` that drives a local Playwright browser for in-process UI audits.

#### Parameters

##### options

[`InProcessUiAuditClientOptions`](#inprocessuiauditclientoptions)

#### Returns

***

### buildAuditorSystemPrompt()

> **buildAuditorSystemPrompt**(`lens`): `string`

Defined in: src/profiles/ui-auditor/lens-prompts.ts:129

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

Defined in: src/profiles/ui-auditor/output-adapter.ts:33

**`Experimental`**

Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`.

#### Parameters

##### events

`SandboxEvent`[]

#### Returns

[`UiAuditOutput`](#uiauditoutput)

***

### uiAuditorProfile()

> **uiAuditorProfile**(`options?`): `object`

Defined in: src/profiles/ui-auditor/profile.ts:46

**`Experimental`**

Preset `runAgentRounds` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs.

#### Parameters

##### options?

[`UiAuditorProfileOptions`](#uiauditorprofileoptions) = `{}`

#### Returns

`object`

##### profile

> **profile**: `AgentProfile`

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

###### Parameters

###### task

[`UiAuditTask`](#uiaudittask)

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<[`UiAuditOutput`](#uiauditoutput)\>

##### validator

> **validator**: [`Validator`](runtime.md#validator-1)\<[`UiAuditOutput`](#uiauditoutput)\>

##### agentRunSpec

> **agentRunSpec**: [`AgentRunSpec`](runtime.md#agentrunspec)\<[`UiAuditTask`](#uiaudittask)\>

***

### encodeAuditTaskEnvelope()

> **encodeAuditTaskEnvelope**(`task`): `string`

Defined in: src/profiles/ui-auditor/prompt.ts:26

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

Defined in: src/profiles/ui-auditor/prompt.ts:37

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

Defined in: src/profiles/ui-auditor/prompt.ts:56

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

Defined in: src/profiles/ui-auditor/validator.ts:52

**`Experimental`**

Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence.

#### Parameters

##### task

[`UiAuditTask`](#uiaudittask)

#### Returns

[`Validator`](runtime.md#validator-1)\<[`UiAuditOutput`](#uiauditoutput)\>
