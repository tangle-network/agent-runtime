import json,sys,math
from itertools import combinations
HH="/tmp/claude-1000/-home-drew-code-supervisor-lab/f06fd156-042a-4ef9-bd88-f2ec7f52b90c/scratchpad/hh"
rows=[json.loads(l) for l in open(f"{HH}/ledger.jsonl") if l.strip()]
rows.sort(key=lambda r:r["iid"])
def b(x): return True if x is True else False

# --- TRUE SUP spend from journal metered events (result.spentTokens=0 on no-winner) ---
import glob as _glob
def _true_sup_tok(iid):
    js=_glob.glob(f"{HH}/runs/{iid}/SUP/ws/.loops/supervisor/*/journal.jsonl")
    if not js: return None
    ti=to=0
    for l in open(js[0]):
        try:o=json.loads(l)
        except:continue
        if o.get("kind")=="metered":
            tk=o.get("spend",{}).get("tokens",{}); ti+=tk.get("input",0) or 0; to+=tk.get("output",0) or 0
    return int(ti+to)
for r in rows:
    tt=_true_sup_tok(r["iid"])
    r["_sup_tok_true"]=tt
    r["_tok_gap"]= (tt is not None and (r.get("sup_spentTokens") or 0) != tt)

n=len(rows)
solo_res=sum(1 for r in rows if b(r.get("solo_resolved")))
sup_res=sum(1 for r in rows if b(r.get("sup_resolved")))
# discordant pairs
sup_only=[r["iid"] for r in rows if b(r.get("sup_resolved")) and not b(r.get("solo_resolved"))]
solo_only=[r["iid"] for r in rows if b(r.get("solo_resolved")) and not b(r.get("sup_resolved"))]
both=[r["iid"] for r in rows if b(r.get("sup_resolved")) and b(r.get("solo_resolved"))]
neither=[r["iid"] for r in rows if not b(r.get("sup_resolved")) and not b(r.get("solo_resolved"))]
# exact two-sided sign test on discordant pairs
def sign_test(a,b_):
    nd=a+b_
    if nd==0: return 1.0
    k=min(a,b_)
    p=sum(math.comb(nd,i) for i in range(0,k+1))/(2**nd)
    return min(1.0, 2*p)
p=sign_test(len(sup_only),len(solo_only))
print("="*80)
print(f"PAIRED HEAD-TO-HEAD: glm-5.2 SOLO vs glm-5.2 SUPERVISOR  (N={n} paired instances)")
print("="*80)
print(f"SOLO resolved: {solo_res}/{n} = {100*solo_res/n:.1f}%")
print(f"SUP  resolved: {sup_res}/{n} = {100*sup_res/n:.1f}%")
print(f"delta (SUP-SOLO): {sup_res-solo_res:+d} instances ({100*(sup_res-solo_res)/n:+.1f} pts)")
print(f"\nDISCORDANT PAIRS (the signal):")
print(f"  SUP-only wins (SUP✓ SOLO✗): {len(sup_only)}  {sup_only}")
print(f"  SOLO-only wins (SOLO✓ SUP✗): {len(solo_only)}  {solo_only}")
print(f"  both resolved: {len(both)}  |  neither: {len(neither)}  {neither}")
print(f"  exact two-sided sign test on discordant pairs: p={p:.4f}")
# cost
def s(r,k): 
    v=r.get(k); return v if isinstance(v,(int,float)) else 0
solo_tok=sum(s(r,"solo_tokens") for r in rows)
sup_tok=sum((r.get("_sup_tok_true") if r.get("_sup_tok_true") is not None else s(r,"sup_spentTokens")) for r in rows)
sup_usd=sum(s(r,"sup_spentUsd") for r in rows)
# derived solo usd at same blended rate as SUP (sup_usd/sup_tok)
rate = (sup_usd/sup_tok) if sup_tok else 0
solo_usd_derived = solo_tok*rate
print(f"\nCOST (measured tokens; USD via shared blended rate ${rate*1e6:.3f}/1M from SUP accounting):")
print(f"  SOLO total tokens: {solo_tok:,}  -> derived ${solo_usd_derived:.4f}")
print(f"  SUP  total tokens: {sup_tok:,}  -> runtime ${sup_usd:.4f}")
if solo_tok: print(f"  SUP/SOLO token ratio: {sup_tok/solo_tok:.2f}x")
if solo_usd_derived: print(f"  SUP/SOLO cost ratio (token-derived): {sup_usd/solo_usd_derived:.2f}x")
gaps=[r["iid"] for r in rows if r.get("_tok_gap")]
print(f"  [telemetry] instances where runtime spentTokens != journal-true (no-winner zeroing): {gaps}")
# wall-time cost (robust)
sw=sum(s(r,"solo_wall_s") for r in rows); pw=sum(s(r,"sup_wall_s") for r in rows)
print(f"  WALL: SOLO {sw}s total vs SUP {pw}s total -> SUP {pw/sw:.2f}x wall" if sw else "")
# per-instance table
print("\n"+"="*80); print("PER-INSTANCE"); print("="*80)
hdr=f"{'instance':32s} {'SOLO':5s} {'SUP':5s} {'v_s':3s} {'v_p':3s} {'wrk':3s} {'soloTok':8s} {'supTok':8s} {'supUSD':7s} {'soloW':5s} {'supW':5s}"
print(hdr)
for r in rows:
    print(f"{r['iid']:32s} {str(b(r.get('solo_resolved')))[:5]:5s} {str(b(r.get('sup_resolved')))[:5]:5s} "
          f"{str(b(r.get('solo_verify_pass')))[0]:3s} {str(b(r.get('sup_verify_pass')))[0]:3s} "
          f"{str(r.get('sup_workers','?')):3s} {str(s(r,'solo_tokens')):8s} {str(s(r,'sup_spentTokens')):8s} "
          f"{s(r,'sup_spentUsd'):.4f} {str(s(r,'solo_wall_s')):5s} {str(s(r,'sup_wall_s')):5s}")
print("\npatches saved under:", f"{HH}/patches/  (<iid>.solo.patch, <iid>.sup.patch)")
