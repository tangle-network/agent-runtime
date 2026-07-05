# Find UI problems on a web page, and file them as issues

Point this at a URL. It opens the page, inspects it through a fixed list of review "lenses"
(accessibility, layout, contrast, and so on), and for every problem it finds it writes a
self-contained GitHub-issue Markdown file — title, description, screenshot — ready to file with
`gh issue create`.

It runs with **no API key**: the example ships a stub reviewer so you can watch the whole pipeline end
to end. For real audits you swap in a vision model (below).

## Why it matters

UI review is exactly the tedious, repeatable check teams skip. This turns it into one command that
produces filed, actionable issues. It also shows how to plug a browser and a visual reviewer into this
library's run loop **without a cloud sandbox** — the browser and reviewer run in-process, but the loop
drives them exactly like any other agent worker.

## Run

```bash
pnpm dlx tsx examples/ui-audit/ui-audit.ts /tmp/ui-audit-demo https://example.com
```

Omit the path and it writes to a temp dir. You get screenshots plus
`issues/NNN--<lens>--<slug>.md` files — file them straight into GitHub with
`gh issue create --body-file <file>`.

## Make it real

The example uses a **stub reviewer** that returns canned findings (so it needs no key). Replace it with
a real vision model — anything that takes an image + a prompt and returns structured findings (OpenAI,
Anthropic, Gemini, a local model). Capturing the page and writing the issue files stays identical; only
the judgment call changes.

## Files

| file | what it is |
|---|---|
| `ui-audit.ts` | the whole run: browse the page, review it lens by lens, write the issue files |
