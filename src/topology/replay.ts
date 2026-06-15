/**
 * @experimental
 *
 * Run replay — the visual, animated record of a recursive agent run.
 *
 * The runtime emits ONE event stream (`agent.spawn`/`agent.child`/`agent.run`/`agent.turn`)
 * through `RuntimeHooks`; the topology tree + waterfall already fold it into ASCII. This module
 * folds the SAME stream into a normalized, timestamped `ReplayEvent[]` (the recorder) and renders
 * a self-contained, animated HTML player (`renderReplayHtml`) — a timeline scrubber over the live
 * recursive tree where every node colors by the completion-oracle: delivered (valid) green, ran-
 * but-not-delivered amber, failed red. No server, no build, no external deps — one HTML file you
 * open in a browser. The same `ReplayEvent[]` is the portable timeline a hosted plane viewer reads.
 */

import type { RuntimeHookEvent, RuntimeHooks } from '../runtime-hooks'

/** One normalized animation frame — a node appearing, settling, or stepping, at a wall-clock ms. */
export interface ReplayEvent {
  t: number
  kind: 'root' | 'spawn' | 'settle' | 'step'
  id: string
  parentId?: string
  label?: string
  runtime?: string
  depth?: number
  status?: 'running' | 'done' | 'down'
  /** The completion-oracle signal: delivered ⟺ a deployable check passed (not self-report). */
  valid?: boolean
  score?: number
  reason?: string
  tokens?: number
  usd?: number
}

export interface ReplayTimeline {
  runId: string
  events: ReplayEvent[]
  /** Wall-clock window [t0, t1] the player scrubs over. */
  t0: number
  t1: number
}

interface RecordedSpend {
  tokens?: { input?: number; output?: number }
  usd?: number
}

function spendTokens(s: RecordedSpend | undefined): number {
  if (!s?.tokens) return 0
  return (s.tokens.input ?? 0) + (s.tokens.output ?? 0)
}

/**
 * A `RuntimeHooks` sink that records every lifecycle event in arrival order as `ReplayEvent`s.
 * Attach it to `SupervisorOpts.hooks` (or merge with another hooks object) and read `timeline()`
 * after the run. Pure capture — no I/O, no throwing; an unrecognized event is ignored.
 */
export function createReplayRecorder(): {
  hooks: RuntimeHooks
  events: ReplayEvent[]
  timeline(runId?: string): ReplayTimeline
} {
  const events: ReplayEvent[] = []
  let runId = 'run'

  const onEvent = (e: RuntimeHookEvent): void => {
    if (e.runId) runId = e.runId
    const t = e.timestamp
    const p = (e.payload ?? {}) as Record<string, unknown>
    switch (e.target) {
      case 'agent.run': {
        // The root driver's lifecycle. `before` plants the root node; `after`/`error` settle it.
        if (e.phase === 'before') {
          events.push({
            t,
            kind: 'root',
            id: e.runId,
            label: String(p.driver ?? 'root'),
            depth: 0,
            status: 'running',
          })
        } else if (e.phase === 'after' || e.phase === 'error') {
          events.push({
            t,
            kind: 'settle',
            id: e.runId,
            status: e.phase === 'error' ? 'down' : 'done',
          })
        }
        break
      }
      case 'agent.spawn': {
        events.push({
          t,
          kind: 'spawn',
          id: String(p.childId ?? e.id),
          ...(e.parentId ? { parentId: e.parentId } : {}),
          label: String(p.label ?? p.childId ?? '?'),
          ...(p.runtime ? { runtime: String(p.runtime) } : {}),
          ...(typeof p.depth === 'number' ? { depth: p.depth } : {}),
          status: 'running',
        })
        break
      }
      case 'agent.child': {
        const spent = p.spent as RecordedSpend | undefined
        events.push({
          t,
          kind: 'settle',
          id: String(p.childId ?? e.id),
          status: (p.status as 'done' | 'down') ?? 'done',
          ...(typeof p.valid === 'boolean' ? { valid: p.valid } : {}),
          ...(typeof p.score === 'number' ? { score: p.score } : {}),
          ...(p.reason ? { reason: String(p.reason) } : {}),
          tokens: spendTokens(spent),
          usd: spent?.usd ?? 0,
        })
        break
      }
      default: {
        // agent.turn / agent.plan / agent.decision / agent.tool_call → a step pulse on the owner.
        const owner = e.parentId ?? e.runId
        if (owner) events.push({ t, kind: 'step', id: owner })
      }
    }
  }

  return {
    hooks: { onEvent },
    events,
    timeline(rid?: string): ReplayTimeline {
      const ts = events.map((e) => e.t)
      const t0 = ts.length ? Math.min(...ts) : 0
      const t1 = ts.length ? Math.max(...ts) : 0
      // Synthesize any node referenced as a parent but never spawned (the supervisor's root
      // driver, and each nested driver's tree root, run via `act`, not `spawn`) so the player
      // renders the WHOLE recursion — driver → worker — not just the spawned leaves.
      const defined = new Set(
        events.filter((e) => e.kind === 'spawn' || e.kind === 'root').map((e) => e.id),
      )
      const synthetic: ReplayEvent[] = []
      for (const id of new Set(events.map((e) => e.parentId).filter((p): p is string => !!p))) {
        if (!defined.has(id))
          synthetic.push({
            t: t0,
            kind: 'root',
            id,
            label: shortRoot(id),
            depth: 0,
            status: 'running',
          })
      }
      return { runId: rid ?? runId, events: [...synthetic, ...events], t0, t1 }
    },
  }
}

/** Render a self-contained animated HTML replay player for a timeline. Open the file in a browser. */
export function renderReplayHtml(timeline: ReplayTimeline, opts?: { title?: string }): string {
  const title = opts?.title ?? `agent replay · ${timeline.runId}`
  const data = JSON.stringify(timeline)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#0b0e14; --panel:#11161f; --line:#2a3340; --txt:#c9d4e3; --dim:#6b7787;
          --run:#e0a73a; --done:#3ad17a; --undeliv:#e0a73a; --down:#e25d5d; --edge:#33405200; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  header { padding:10px 16px; border-bottom:1px solid var(--line); display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  header b { color:#fff; font-weight:600; } .stat { color:var(--dim); } .stat span { color:var(--txt); }
  #wrap { display:flex; height:calc(100vh - 112px); }
  #stage { flex:1; overflow:auto; }
  #side { width:280px; border-left:1px solid var(--line); padding:14px; overflow:auto; background:var(--panel); }
  #side h3 { margin:0 0 8px; font-size:12px; color:var(--dim); text-transform:uppercase; letter-spacing:.08em; }
  #side .k { color:var(--dim); } #side .row { margin:3px 0; }
  svg { display:block; } .node circle { stroke:#0b0e14; stroke-width:2; cursor:pointer; }
  .node text { fill:var(--txt); font-size:11px; } .node .sub { fill:var(--dim); font-size:9px; }
  .edge { stroke:#2a3340; stroke-width:1.5; fill:none; }
  .hidden { opacity:0; } .node, .edge { transition:opacity .25s ease, fill .25s, stroke .25s; }
  footer { padding:10px 16px; border-top:1px solid var(--line); display:flex; gap:14px; align-items:center; }
  button { background:#1b2433; color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:6px 14px; cursor:pointer; font:inherit; }
  button:hover { background:#243047; } input[type=range] { flex:1; accent-color:#3ad17a; }
  select { background:#1b2433; color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:5px; }
  .legend i { display:inline-block; width:9px; height:9px; border-radius:50%; margin:0 4px 0 10px; vertical-align:middle; }
</style></head><body>
<header>
  <b>${escapeHtml(title)}</b>
  <span class="legend"><i style="background:var(--run)"></i>running<i style="background:var(--done)"></i>delivered<i style="background:var(--down)"></i>failed</span>
  <span class="stat">t <span id="clock">0.0s</span></span>
  <span class="stat">nodes <span id="cNodes">0</span></span>
  <span class="stat">delivered <span id="cDeliv">0</span></span>
  <span class="stat">tokens <span id="cTok">0</span></span>
  <span class="stat">$<span id="cUsd">0.000</span></span>
</header>
<div id="wrap"><div id="stage"><svg id="svg"></svg></div>
<div id="side"><h3>node</h3><div id="detail" class="stat">hover a node…</div></div></div>
<footer>
  <button id="play">▶ play</button>
  <button id="restart">⟲</button>
  <input type="range" id="scrub" min="0" max="1000" value="0"/>
  <select id="speed"><option value="1">1×</option><option value="2">2×</option><option value="4" selected>4×</option><option value="8">8×</option><option value="20">20×</option></select>
</footer>
<script>
const TL = ${data};
const EV = TL.events.slice().sort((a,b)=>a.t-b.t);
const span = Math.max(1, TL.t1 - TL.t0);
// ── build the full tree (nodes known from spawn/root events) ──
const nodes = new Map();
for (const e of EV) {
  if (e.kind==='root' || e.kind==='spawn') {
    if (!nodes.has(e.id)) nodes.set(e.id, { id:e.id, parentId:e.parentId, label:e.label||e.id, runtime:e.runtime, depth:e.depth??0, tSpawn:e.t, children:[] });
  }
}
for (const n of nodes.values()) { if (n.parentId && nodes.has(n.parentId)) nodes.get(n.parentId).children.push(n); }
const roots = [...nodes.values()].filter(n=>!n.parentId || !nodes.has(n.parentId));
// ── tidy layout: post-order leaf slotting; x=avg(children), y=depth ──
let leaf=0; const VGAP=78, HGAP=120;
function layout(n, d){ n.y = 40 + d*VGAP; if(!n.children.length){ n.x = 40 + (leaf++)*HGAP; } else { n.children.forEach(c=>layout(c,d+1)); n.x = (n.children[0].x + n.children[n.children.length-1].x)/2; } }
roots.forEach(r=>layout(r,0));
const W = Math.max(900, 80 + leaf*HGAP), H = 80 + (Math.max(0,...[...nodes.values()].map(n=>n.depth||0))+1)*VGAP;
const svg = document.getElementById('svg'); svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
const NS='http://www.w3.org/2000/svg';
function el(t,a){ const x=document.createElementNS(NS,t); for(const k in a) x.setAttribute(k,a[k]); return x; }
// edges
const edgeEls=new Map();
for (const n of nodes.values()) if (n.parentId && nodes.has(n.parentId)) { const p=nodes.get(n.parentId);
  const path=el('path',{class:'edge hidden', d:'M'+p.x+','+(p.y)+' C'+p.x+','+((p.y+n.y)/2)+' '+n.x+','+((p.y+n.y)/2)+' '+n.x+','+n.y}); svg.appendChild(path); edgeEls.set(n.id,path); }
// nodes
const nodeEls=new Map();
for (const n of nodes.values()) { const g=el('g',{class:'node hidden'});
  const c=el('circle',{cx:n.x,cy:n.y,r:14,fill:'var(--dim)'});
  const t=el('text',{x:n.x,y:n.y-20,'text-anchor':'middle'}); t.textContent=n.label.slice(0,18);
  const s=el('text',{class:'sub',x:n.x,y:n.y+26,'text-anchor':'middle'}); s.textContent=n.runtime||'';
  g.appendChild(c); g.appendChild(t); g.appendChild(s); svg.appendChild(g); nodeEls.set(n.id,{g,c,s});
  g.addEventListener('mouseenter',()=>showDetail(n)); }
function showDetail(n){ const st=state.get(n.id)||{}; document.getElementById('detail').innerHTML =
  '<div class="row"><span class="k">id</span> '+n.id+'</div>'+
  '<div class="row"><span class="k">label</span> '+esc(n.label)+'</div>'+
  '<div class="row"><span class="k">runtime</span> '+(n.runtime||'—')+'</div>'+
  '<div class="row"><span class="k">depth</span> '+(n.depth??0)+'</div>'+
  '<div class="row"><span class="k">status</span> '+(st.status||'—')+(st.valid===false?' (not delivered)':st.valid?' (delivered)':'')+'</div>'+
  '<div class="row"><span class="k">score</span> '+(st.score!=null?st.score.toFixed(2):'—')+'</div>'+
  (st.reason?'<div class="row"><span class="k">reason</span> '+esc(st.reason)+'</div>':'')+
  '<div class="row"><span class="k">tokens</span> '+(st.tokens||0)+'</div>'; }
function esc(x){ return String(x).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
// ── playback ──
const state=new Map();
function colorOf(st){ if(!st||st.status==='running'||!st.status) return 'var(--run)'; if(st.status==='down') return 'var(--down)'; return st.valid===false ? 'var(--undeliv)' : 'var(--done)'; }
function applyTo(ms){ const clk=TL.t0+ms; state.clear();
  let deliv=0, tok=0, usd=0, shown=0;
  // reset visibility
  for (const [,v] of nodeEls){ v.g.classList.add('hidden'); }
  for (const [,p] of edgeEls){ p.classList.add('hidden'); }
  for (const e of EV){ if (e.t>clk) break;
    if (e.kind==='spawn'||e.kind==='root'){ const ne=nodeEls.get(e.id); if(ne){ ne.g.classList.remove('hidden'); shown++; const ed=edgeEls.get(e.id); if(ed) ed.classList.remove('hidden'); } state.set(e.id, Object.assign(state.get(e.id)||{}, {status:'running'})); }
    else if (e.kind==='settle'){ const st=Object.assign(state.get(e.id)||{}, {status:e.status, valid:e.valid, score:e.score, reason:e.reason, tokens:e.tokens, usd:e.usd}); state.set(e.id,st); }
  }
  for (const [id,st] of state){ const ne=nodeEls.get(id); if(ne) ne.c.setAttribute('fill', colorOf(st)); if(st.status&&st.status!=='running'){ if(st.status==='done'&&st.valid!==false) deliv++; tok+=st.tokens||0; usd+=st.usd||0; } }
  document.getElementById('clock').textContent=(ms/1000).toFixed(1)+'s';
  document.getElementById('cNodes').textContent=shown;
  document.getElementById('cDeliv').textContent=deliv;
  document.getElementById('cTok').textContent=tok;
  document.getElementById('cUsd').textContent=usd.toFixed(3);
}
const scrub=document.getElementById('scrub'); let playing=false, raf=0, last=0;
function setMs(ms){ ms=Math.max(0,Math.min(span,ms)); scrub.value=(ms/span*1000)|0; applyTo(ms); }
scrub.addEventListener('input',()=>setMs(scrub.value/1000*span));
document.getElementById('play').addEventListener('click',()=>{ playing=!playing; document.getElementById('play').textContent=playing?'⏸ pause':'▶ play'; if(playing){ last=performance.now(); if((scrub.value/1000*span)>=span) setMs(0); tick(); } });
document.getElementById('restart').addEventListener('click',()=>{ setMs(0); });
function tick(){ if(!playing) return; const now=performance.now(); const sp=+document.getElementById('speed').value; let ms=scrub.value/1000*span + (now-last)*sp; last=now; if(ms>=span){ ms=span; playing=false; document.getElementById('play').textContent='▶ play'; } setMs(ms); if(playing) raf=requestAnimationFrame(tick); }
setMs(0);
</script></body></html>`
}

/** A readable label for a synthesized root node (the last path segment of a nested tree key). */
function shortRoot(id: string): string {
  const seg = id.split('/').pop() ?? id
  return seg.length > 22 ? `…${seg.slice(-21)}` : seg
}

function escapeHtml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  )
}
