"""
Python agno agent -> Tangle Intelligence. No sandbox, no Tangle SDK.

The same canonical OTel GenAI spans the TypeScript shapes emit, from a
Python agno agent. Two ways, same engine:

  1. Hosted: POST OTLP/HTTP-JSON straight to the ingest route. Works with
     any Python agent; no Tangle dependency at all.
  2. Substrate (via the published `agent-eval-rpc` client): judge/analyze
     over the wire — `pip install agent-eval-rpc`.

Run (live):  TANGLE_API_KEY=sk-tan-... python agno_to_intelligence.py
Without agno installed it falls back to a recorded batch so the wiring is
runnable as-is.
"""

import json
import os
import time
import urllib.request

INTELLIGENCE_BASE = os.environ.get(
    "INTELLIGENCE_BASE", "https://intelligence.tangle.tools/v1/otlp"
)
API_KEY = os.environ.get("TANGLE_API_KEY", "sk-tan-...")


def run_agno_agent(prompt: str) -> dict:
    """Run a real agno agent if installed; else a recorded run so this
    file is runnable without the dep. Live wiring shown inline."""
    try:
        from agno.agent import Agent  # type: ignore
        from agno.models.openai import OpenAIChat  # type: ignore

        agent = Agent(model=OpenAIChat(id="gpt-4o"))
        resp = agent.run(prompt)
        usage = getattr(resp, "metrics", {}) or {}
        return {
            "model": "openai/gpt-4o",
            "input_tokens": int(usage.get("input_tokens", 0) or 0),
            "output_tokens": int(usage.get("output_tokens", 0) or 0),
            "cost_usd": float(usage.get("cost", 0.0) or 0.0),
            # Your acceptance check / judge score in 0..1.
            "score": 1.0 if resp and getattr(resp, "content", None) else 0.0,
            "failure_mode": None if getattr(resp, "content", None) else "format_drift",
        }
    except Exception:
        # Recorded run — agno not installed or no key. Wiring stays valid.
        return {
            "model": "openai/gpt-4o",
            "input_tokens": 1240,
            "output_tokens": 320,
            "cost_usd": 0.018,
            "score": 0.83,
            "failure_mode": None,
        }


def otlp_spans_for_run(run_id: str, r: dict) -> list[dict]:
    now_ns = time.time_ns()
    attrs = [
        {"key": "gen_ai.request.model", "value": {"stringValue": r["model"]}},
        {"key": "gen_ai.usage.input_tokens", "value": {"doubleValue": r["input_tokens"]}},
        {"key": "gen_ai.usage.output_tokens", "value": {"doubleValue": r["output_tokens"]}},
        {"key": "gen_ai.usage.cost_usd", "value": {"doubleValue": r["cost_usd"]}},
        {"key": "score", "value": {"doubleValue": r["score"]}},
    ]
    spans = [
        {
            "traceId": run_id,
            "spanId": f"{run_id}-llm",
            "name": "gen_ai.chat",
            "startTimeUnixNano": str(now_ns),
            "endTimeUnixNano": str(now_ns + 800_000_000),
            "attributes": attrs,
            "status": {"code": "STATUS_CODE_ERROR" if r["failure_mode"] else "STATUS_CODE_OK"},
        }
    ]
    if r["failure_mode"]:
        spans.append(
            {
                "traceId": run_id,
                "spanId": f"{run_id}-err",
                "name": r["failure_mode"],
                "startTimeUnixNano": str(now_ns + 800_000_000),
                "endTimeUnixNano": str(now_ns + 800_000_000),
                "attributes": [],
                "status": {"code": "STATUS_CODE_ERROR"},
            }
        )
    return spans


def ship(spans: list[dict]) -> None:
    body = json.dumps(
        {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [
                            {"key": "service.name", "value": {"stringValue": "agno-agent"}}
                        ]
                    },
                    "scopeSpans": [{"scope": {"name": "agno"}, "spans": spans}],
                }
            ]
        }
    ).encode()
    req = urllib.request.Request(
        f"{INTELLIGENCE_BASE}/v1/traces",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"ingest failed: {resp.status}")


if __name__ == "__main__":
    prompts = ["Summarise the Q3 report", "Draft a follow-up email", "Classify this ticket"]
    all_spans: list[dict] = []
    for i, p in enumerate(prompts):
        all_spans += otlp_spans_for_run(f"agno-{i}", run_agno_agent(p))
    if API_KEY != "sk-tan-...":
        ship(all_spans)
        print(f"Shipped {len(all_spans)} spans from agno → Tangle Intelligence.")
    else:
        print("(set TANGLE_API_KEY to ship; printing spans)\n", json.dumps(all_spans, indent=2)[:600])
