[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiAuditCaptureRequest

# Interface: UiAuditCaptureRequest

Defined in: [profiles/ui-auditor/task.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L22)

**`Experimental`**

## Properties

### route

> **route**: `string`

Defined in: [profiles/ui-auditor/task.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L27)

**`Experimental`**

Logical route name (e.g. `home`, `checkout-step-2`). Used in screenshot
filenames and finding metadata.

***

### url

> **url**: `string`

Defined in: [profiles/ui-auditor/task.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L29)

**`Experimental`**

Fully qualified URL the iteration audits.

***

### viewport?

> `optional` **viewport?**: [`UiAuditViewport`](UiAuditViewport.md)

Defined in: [profiles/ui-auditor/task.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L31)

**`Experimental`**

Default `{ width: 1280, height: 800 }`.

***

### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: [profiles/ui-auditor/task.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L33)

**`Experimental`**

Default `false`.

***

### waitFor?

> `optional` **waitFor?**: `string`

Defined in: [profiles/ui-auditor/task.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L35)

**`Experimental`**

CSS selector to wait for before capturing.

***

### waitMs?

> `optional` **waitMs?**: `number`

Defined in: [profiles/ui-auditor/task.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L37)

**`Experimental`**

Extra milliseconds to wait after navigation settles. Default `500`.

***

### elementSelector?

> `optional` **elementSelector?**: `string`

Defined in: [profiles/ui-auditor/task.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L39)

**`Experimental`**

Optional CSS selector — capture only the matched element.

***

### label?

> `optional` **label?**: `string`

Defined in: [profiles/ui-auditor/task.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L41)

**`Experimental`**

Optional human-readable label appended to the screenshot filename.
