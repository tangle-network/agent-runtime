/**
 * Mind2Web adapter (osunlp/Multimodal-Mind2Web, split 'test_domain' by default).
 * Web-agent ACTION PREDICTION: each task is one step of a real web task — given
 * the natural-language goal and the page's candidate elements, the worker picks
 * the SINGLE element to act on and the action (CLICK / TYPE / SELECT [+ value]).
 *
 * Judge is the published Mind2Web step metric, FULLY DETERMINISTIC — no LLM:
 *   element correct  ⇔ predicted backend_node_id ∈ pos_candidates ids
 *   operation correct ⇔ op-type matches AND (TYPE/SELECT) the value matches
 *   resolved (Step-SR) ⇔ element correct AND operation correct
 *   score = 0.6·element + 0.4·operation  (a gradient for the optimizer; the right
 *           element is most of the credit, mirroring Element-Acc ≫ Op as the lever)
 * This is the low-noise reward a certifiable directive-lift needs: the number is a
 * programmatic match against human-verified ground truth, not a judge's opinion.
 *
 * The worker artifact is three sentinel lines (ELEMENT / ACTION / VALUE) so the
 * judge extracts deterministically; the prompt presents the candidate set as a
 * choice over backend_node_id ordered by id (position uncorrelated with the answer).
 *
 * Each step carries the dataset's OWN page screenshot (written to a temp file by
 * the loader); the worker drops it into a browser.<op> span so run-capsule's screen
 * capsule turns the run into a film — the real page, not a re-rendered DOM.
 *
 * Requires for a live run: a python with `datasets` + `pillow` and network to
 * Hugging Face. Point M2W_PYTHON at it (defaults to bench/.venv/bin/python).
 */

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = process.env.M2W_PYTHON ?? join(BENCH_ROOT, '.venv', 'bin', 'python')

const DATASET = 'osunlp/Multimodal-Mind2Web'
const DEFAULT_SPLIT = process.env.M2W_SPLIT ?? 'test_domain'
const SHOTS_DIR = process.env.M2W_SHOTS ?? join(tmpdir(), 'm2w-shots')
/** Candidate-set cap presented to the worker (always keeps all pos candidates). */
const CANDIDATE_CAP = Number(process.env.M2W_CANDIDATE_CAP ?? 30)

/** The worker contract appended to every task prompt; the judge keys off these. */
const WORKER_CONTRACT = [
  '',
  'Pick the SINGLE next element to act on, then end your response with EXACTLY these three lines:',
  'ELEMENT: <the [id] number of the chosen element>',
  'ACTION: <CLICK | TYPE | SELECT>',
  'VALUE: <text to type or option to select; leave empty for CLICK>',
].join('\n')

interface RawCandidate {
  id: string
  label: string
}
interface Mind2WebRow {
  id: string
  task: string
  website: string
  domain: string
  subdomain: string
  op: string
  value: string
  goldIds: string[]
  candidates: RawCandidate[]
  screenshotPath: string
  targetRepr: string
}
interface Mind2WebMeta {
  task: string
  website: string
  domain: string
  op: string
  value: string
  goldIds: string[]
  candidateIds: string[]
  screenshotPath: string
  targetRepr: string
}

/** Run the bench python with a script on stdin; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], { maxBuffer: 1024 * 1024 * 256 })
  return stdout
}

/** The loader: stream the split, skip steps with no positive candidate (fail-loud,
 *  never a silent score-0), cap the candidate set, save each screenshot to a file. */
const LOADER = `
import json, sys, os
from datasets import load_dataset
cfg = json.loads(sys.argv[1])
split = cfg["split"]; limit = cfg.get("limit"); cap = cfg.get("cap", 30)
shots = cfg["shotsDir"]; ids = set(cfg["ids"]) if cfg.get("ids") else None
os.makedirs(shots, exist_ok=True)
KEEP = ("aria_label","aria-label","role","type","name","placeholder","title","alt","value","text","id","class","href")
def label(tag, attr):
    try:
        a = json.loads(attr) if isinstance(attr, str) else (attr or {})
    except Exception:
        a = {}
    parts = []
    for k in KEEP:
        v = a.get(k)
        if v:
            sv = str(v).replace("\\n", " ").strip()
            if k == "class": sv = sv[:40]
            if k == "href": sv = sv[:50]
            if sv: parts.append(k + "=" + sv[:60])
    return "<" + str(tag) + "> " + " ".join(parts[:6])
def cands(raw):
    out = []
    for c in raw or []:
        try:
            d = json.loads(c) if isinstance(c, str) else c
        except Exception:
            continue
        bid = str(d.get("backend_node_id", ""))
        if not bid: continue
        out.append({"id": bid, "label": label(d.get("tag", "?"), d.get("attributes"))})
    return out
ds = load_dataset(${JSON.stringify(DATASET)}, split=split, streaming=True)
emitted = []; skipped = 0; scanned = 0
for r in ds:
    scanned += 1
    if ids is not None and r["action_uid"] not in ids:
        if scanned > 8000: break
        continue
    pos = cands(r.get("pos_candidates"))
    if not pos:
        skipped += 1
        continue
    neg = cands(r.get("neg_candidates"))
    seen = set(p["id"] for p in pos); merged = list(pos)
    for n in neg:
        if len(merged) >= cap: break
        if n["id"] in seen: continue
        seen.add(n["id"]); merged.append(n)
    merged.sort(key=lambda x: int(x["id"]) if x["id"].isdigit() else 0)
    try:
        op = json.loads(r["operation"]) if isinstance(r["operation"], str) else r["operation"]
    except Exception:
        op = {}
    sp = os.path.join(shots, str(r["action_uid"]) + ".jpg")
    try:
        r["screenshot"].convert("RGB").save(sp, "JPEG", quality=70)
    except Exception:
        sp = ""
    emitted.append({
        "id": r["action_uid"], "task": r.get("confirmed_task", ""),
        "website": r.get("website", ""), "domain": r.get("domain", ""), "subdomain": r.get("subdomain", ""),
        "op": str(op.get("op", "")).upper(), "value": str(op.get("value", "")),
        "goldIds": [p["id"] for p in pos], "candidates": merged,
        "screenshotPath": sp, "targetRepr": r.get("target_action_reprs", ""),
    })
    if ids is None and limit is not None and len(emitted) >= limit: break
    if ids is not None and len(emitted) >= len(ids): break
sys.stderr.write("[mind2web] emitted=%d skipped_empty_pos=%d scanned=%d\\n" % (len(emitted), skipped, scanned)); sys.stderr.flush()
print(json.dumps(emitted)); sys.stdout.flush()
os._exit(0)
`

function buildPrompt(row: Mind2WebRow): string {
  const choices = row.candidates.map((c) => `  [${c.id}] ${c.label}`).join('\n')
  return [
    `Web task: ${row.task}`,
    '',
    'You are taking the NEXT single action on the current web page. Choose the one element',
    'to act on from the candidates below (each line is "[id] <tag> attributes"):',
    choices,
    WORKER_CONTRACT,
  ].join('\n')
}

function rowToTask(row: Mind2WebRow): BenchTask {
  const meta: Mind2WebMeta = {
    task: row.task,
    website: row.website,
    domain: row.domain,
    op: row.op,
    value: row.value,
    goldIds: row.goldIds,
    candidateIds: row.candidates.map((c) => c.id),
    screenshotPath: row.screenshotPath,
    targetRepr: row.targetRepr,
  }
  return {
    id: `mind2web-${row.id}`,
    split: DEFAULT_SPLIT,
    prompt: buildPrompt(row),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): Mind2WebMeta {
  const md = task.metadata
  if (!md || !Array.isArray((md as { goldIds?: unknown }).goldIds)) {
    throw new Error(`mind2web task ${task.id} missing metadata.goldIds — loadTasks did not populate it`)
  }
  return md as unknown as Mind2WebMeta
}

/** Normalize a TYPE/SELECT value for comparison: lowercase, collapse whitespace. */
function normValue(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface ParsedAction {
  elementId: string
  op: string
  value: string
}

/** Parse the worker artifact's ELEMENT / ACTION / VALUE sentinel lines.
 *  Fail-closed: a missing ELEMENT or ACTION returns null (judge → resolved=false). */
export function parseAction(artifact: string): ParsedAction | null {
  const elem = /ELEMENT:\s*\[?(\d+)\]?/i.exec(artifact)
  const op = /ACTION:\s*(CLICK|TYPE|SELECT)/i.exec(artifact)
  if (!elem?.[1] || !op?.[1]) return null
  const val = /VALUE:\s*(.*)/i.exec(artifact)
  return { elementId: elem[1], op: op[1].toUpperCase(), value: (val?.[1] ?? '').trim() }
}

export function createMind2WebAdapter(): BenchmarkAdapter {
  const split = DEFAULT_SPLIT

  return {
    name: 'mind2web',

    async preflight() {
      try {
        await py(
          `import os, sys
from datasets import load_dataset
import PIL
ds = load_dataset(${JSON.stringify(DATASET)}, split=${JSON.stringify(split)}, streaming=True)
next(iter(ds))
print('ok'); sys.stdout.flush(); os._exit(0)`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `mind2web preflight failed: ${msg}\n` +
            `Fix: (1) a python with datasets + pillow (python3 -m venv bench/.venv && bench/.venv/bin/pip install datasets pillow) ; ` +
            `(2) network access to Hugging Face for ${DATASET} (split ${split}) ; ` +
            `point M2W_PYTHON at the python if not bench/.venv.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      const cfg = {
        split: opts.split ?? split,
        limit: opts.ids ? undefined : (opts.limit ?? 10),
        cap: CANDIDATE_CAP,
        shotsDir: SHOTS_DIR,
        ids: opts.ids ? opts.ids.map((id) => id.replace(/^mind2web-/, '')) : undefined,
      }
      await mkdir(SHOTS_DIR, { recursive: true })
      const stdout = await py(LOADER, [JSON.stringify(cfg)])
      const rows = JSON.parse(stdout) as Mind2WebRow[]
      return rows.map(rowToTask)
    },

    async goldArtifact(task: BenchTask) {
      // Gold = the worker-contract serialization of the ground-truth action, so
      // verify-judge proves gold→resolved through the SAME parse path the real
      // artifact takes. The first accepted positive id is the canonical target.
      const meta = readMeta(task)
      const id = meta.goldIds[0]
      if (!id) return undefined
      return `ELEMENT: ${id}\nACTION: ${meta.op}\nVALUE: ${meta.value}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const parsed = parseAction(artifact)
      if (!parsed) {
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({ reason: 'no parseable ELEMENT/ACTION', goldOp: meta.op, goldIds: meta.goldIds }),
        }
      }
      const elementCorrect = meta.goldIds.includes(parsed.elementId)
      const opMatch = parsed.op === meta.op
      const valueMatch = meta.op === 'CLICK' ? true : normValue(parsed.value) === normValue(meta.value)
      const operationCorrect = opMatch && valueMatch
      const resolved = elementCorrect && operationCorrect
      const score = 0.6 * (elementCorrect ? 1 : 0) + 0.4 * (operationCorrect ? 1 : 0)
      return {
        resolved,
        score,
        detail: JSON.stringify({
          elementCorrect,
          opMatch,
          valueMatch,
          predicted: parsed,
          goldOp: meta.op,
          goldValue: meta.value,
          goldIds: meta.goldIds,
          website: meta.website,
          domain: meta.domain,
        }),
      }
    },
  }
}
