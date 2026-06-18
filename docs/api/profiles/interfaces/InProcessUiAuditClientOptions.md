[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / InProcessUiAuditClientOptions

# Interface: InProcessUiAuditClientOptions

Defined in: [profiles/ui-auditor/in-process-client.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L45)

**`Experimental`**

## Properties

### workspaceDir

> **workspaceDir**: `string`

Defined in: [profiles/ui-auditor/in-process-client.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L51)

**`Experimental`**

Absolute path under which screenshots are written. Each capture lands
at `<workspaceDir>/screenshots/<filename>`; finding screenshot paths
are workspace-relative (`screenshots/<filename>`).

***

### judge

> **judge**: [`UiJudge`](../type-aliases/UiJudge.md)

Defined in: [profiles/ui-auditor/in-process-client.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L53)

**`Experimental`**

The vision judge that turns captures into findings.

***

### navPolicy?

> `optional` **navPolicy?**: `"strict"` \| `"spa"`

Defined in: [profiles/ui-auditor/in-process-client.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L62)

**`Experimental`**

Navigation policy.

`'strict'` (default) waits for `networkidle` and fails the iteration
if the page does not settle. `'spa'` waits for `domcontentloaded` —
use for single-page apps that hold open long-poll/websocket
connections and never settle.

***

### launchBrowser?

> `optional` **launchBrowser?**: () => `Promise`\<[`BrowserHandle`](BrowserHandle.md)\>

Defined in: [profiles/ui-auditor/in-process-client.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L68)

**`Experimental`**

Browser launch override. Default: chromium headless via Playwright.
Consumers pass a custom factory to target a remote browser, a
different channel, or a fleet adapter.

#### Returns

`Promise`\<[`BrowserHandle`](BrowserHandle.md)\>
