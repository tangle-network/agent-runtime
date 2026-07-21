#!/usr/bin/env python3
"""Autogenerate a self-contained observability dashboard (topology + telemetry) from a stream run.
Usage: python stream-observe.py <STREAM_DIR> [REF_DIR] > out.html
Reads <dir>/{ledger.jsonl, events.jsonl, plan.json}. Reproducible: re-run anytime for live state."""
import json, sys, os
from collections import Counter
from html import escape

def load(d):
    def jl(p): 
        try: return [json.loads(l) for l in open(os.path.join(d,p))]
        except FileNotFoundError: return []
    def jf(p):
        try: return json.load(open(os.path.join(d,p)))
        except FileNotFoundError: return []
    return jl('ledger.jsonl'), jl('events.jsonl'), jf('plan.json')

def curve(rows):
    by={}
    for r in rows: by.setdefault(r['streamIndex'],{})[r['arm']]=r
    out=[]; cf=cl=n=0; costF=costL=fires=goodfires=0
    for i in sorted(by):
        f,l=by[i].get('F'),by[i].get('L')
        if not f or not l: continue
        sp=l.get('supervisorPlan') or {}
        if sp.get('fired'): fires+=1
        if sp.get('fired') and len(sp.get('plan') or '')>50: goodfires+=1
        if f.get('error') or l.get('error'):
            out.append({'i':i,'id':f['instanceId'].split('__')[-1],'err':(f.get('error') or l.get('error'))[:16]}); continue
        n+=1; cf+=1 if f.get('hiddenResolved') else 0; cl+=1 if l.get('hiddenResolved') else 0
        costF+=f.get('usd',0); costL+=l.get('usd',0)
        out.append({'i':i,'id':f['instanceId'].split('__')[-1],'F':int(bool(f.get('hiddenResolved'))),'L':int(bool(l.get('hiddenResolved'))),
                    'cumF':round(cf/n,3),'cumL':round(cl/n,3),'recall':(l.get('recall') or {}).get('injectedChars',0),
                    'supFired':bool(sp.get('fired')),'supReason':sp.get('reason','')})
    return out,{'scored':n,'F':cf,'L':cl,'costF':round(costF,2),'costL':round(costL,2),'fires':fires,'goodfires':goodfires}

sd=sys.argv[1]; ref=sys.argv[2] if len(sys.argv)>2 else sd
lrows,levents,lplan=load(sd)
rrows,_,_=load(ref)
lc,lstat=curve(lrows)
rc,rstat=curve(rrows)
data={'live':{'events':dict(Counter(e.get('type') for e in levents)) or {'(none)':0},'plan':lplan,'curve':lc,'stat':lstat,'dir':os.path.basename(sd)},
      'ref':{'curve':rc,'stat':rstat,'dir':os.path.basename(ref)}}
tpl=open(os.path.join(os.path.dirname(__file__),'stream-observe.tpl.html')).read()
sys.stdout.write(tpl.replace('__DATA__', json.dumps(data)))
