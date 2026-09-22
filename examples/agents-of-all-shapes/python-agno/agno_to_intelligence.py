"""Send live Agno runs to Tangle Intelligence over OTLP/HTTP.

Install `agno==2.8.3` and `openai`, set `OPENAI_API_KEY`, then run:

    TANGLE_API_KEY=sk-tan-... python agno_to_intelligence.py

This example has no Tangle Python dependency.
"""

import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.request

INTELLIGENCE_BASE = (
    os.environ.get(
        "TANGLE_INTELLIGENCE_URL", "https://intelligence.tangle.tools"
    ).rstrip("/")
    + "/v1/otlp"
)
API_KEY = os.environ.get("TANGLE_API_KEY")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini-2024-07-18")
CANDIDATE_ID = f"agno:openai/{MODEL}"


def run_agno_agent(scenario_id: str, prompt: str, expected: str) -> dict:
    """Run Agno and return the measured fields used by the OTLP projection."""
    from agno.agent import Agent
    from agno.models.openai import OpenAIChat
    from agno.run.base import RunStatus

    start_ns = time.time_ns()
    response = Agent(model=OpenAIChat(id=MODEL)).run(prompt)
    end_ns = time.time_ns()
    if not response.run_id:
        raise RuntimeError("Agno returned no run_id.")
    if not response.model or not response.model_provider:
        raise RuntimeError("Agno returned no model identity.")
    if response.metrics is None:
        raise RuntimeError("Agno returned no run metrics.")

    metrics = response.metrics
    succeeded = response.status == RunStatus.completed
    if succeeded:
        if not isinstance(response.content, str):
            raise RuntimeError(
                "Agno returned non-text content for a text-only scenario."
            )
        score = 1.0 if response.content.strip() == expected else 0.0
    else:
        score = None
    cost_usd = float(metrics.cost) if metrics.cost is not None else None
    input_tokens = int(metrics.input_tokens)
    output_tokens = int(metrics.output_tokens)
    if input_tokens < 0 or output_tokens < 0:
        raise RuntimeError("Agno returned negative token usage.")
    if cost_usd is not None and (not math.isfinite(cost_usd) or cost_usd < 0):
        raise RuntimeError("Agno returned an invalid cost.")
    return {
        "run_id": response.run_id,
        "candidate_id": CANDIDATE_ID,
        "scenario_id": scenario_id,
        "model": f"{response.model_provider}/{response.model}",
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost_usd,
        "cost_provenance": "observed" if cost_usd is not None else "uncaptured",
        "score": score,
        "failure_class": (
            "instruction_following" if score is not None and score < 1.0 else None
        ),
        "terminal_outcome": "succeeded" if succeeded else "failed",
        "terminal_failure_reason": None if succeeded else response.status.value,
        "start_ns": start_ns,
        "end_ns": end_ns,
    }


def otlp_value(value: str | int | float | bool) -> dict:
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    return {"doubleValue": value}


def otlp_attribute(key: str, value: str | int | float | bool) -> dict:
    return {"key": key, "value": otlp_value(value)}


def stable_otel_id(domain: str, value: str, length: int) -> str:
    identifier = hashlib.sha256(f"{domain}\0{value}".encode()).hexdigest()[:length]
    return identifier if identifier.strip("0") else ("0" * (length - 1) + "1")


def distinct_span_id(candidate: str, parent: str) -> str:
    if candidate != parent:
        return candidate
    final_nibble = "1" if candidate.endswith("0") else "0"
    return candidate[:-1] + final_nibble


def otlp_spans_for_run(run: dict) -> list[dict]:
    trace_id = stable_otel_id("trace", run["run_id"], 32)
    root_span_id = stable_otel_id("span", f"{run['run_id']}:root", 16)
    llm_span_id = distinct_span_id(
        stable_otel_id("span", f"{run['run_id']}:model:0", 16), root_span_id
    )
    identity = [
        otlp_attribute("tangle.runId", run["run_id"]),
        otlp_attribute("tangle.candidateId", run["candidate_id"]),
        otlp_attribute("tangle.scenarioId", run["scenario_id"]),
    ]
    root_attrs = [
        *identity,
        otlp_attribute("openinference.span.kind", "AGENT"),
        otlp_attribute("tangle.terminal.outcome", run["terminal_outcome"]),
        otlp_attribute("tangle.cost.provenance", run["cost_provenance"]),
    ]
    if run["score"] is not None:
        root_attrs.append(otlp_attribute("tangle.task.score", run["score"]))
    if run["failure_class"]:
        root_attrs.append(
            otlp_attribute("tangle.task.failure_class", run["failure_class"])
        )
    if run["terminal_failure_reason"]:
        root_attrs.append(
            otlp_attribute(
                "tangle.terminal.failure_reason", run["terminal_failure_reason"]
            )
        )
    llm_attrs = [
        *identity,
        otlp_attribute("openinference.span.kind", "LLM"),
        otlp_attribute("gen_ai.request.model", run["model"]),
        otlp_attribute("gen_ai.usage.input_tokens", run["input_tokens"]),
        otlp_attribute("gen_ai.usage.output_tokens", run["output_tokens"]),
        otlp_attribute("tangle.cost.provenance", run["cost_provenance"]),
    ]
    if run["cost_usd"] is not None:
        llm_attrs.append(otlp_attribute("gen_ai.usage.cost_usd", run["cost_usd"]))
    return [
        {
            "traceId": trace_id,
            "spanId": root_span_id,
            "name": "agent.run",
            "startTimeUnixNano": str(run["start_ns"]),
            "endTimeUnixNano": str(run["end_ns"]),
            "attributes": root_attrs,
            "status": {
                "code": 1 if run["terminal_outcome"] == "succeeded" else 2,
                **(
                    {"message": run["terminal_failure_reason"]}
                    if run["terminal_failure_reason"]
                    else {}
                ),
            },
        },
        {
            "traceId": trace_id,
            "spanId": llm_span_id,
            "parentSpanId": root_span_id,
            "name": "gen_ai.chat",
            "startTimeUnixNano": str(run["start_ns"]),
            "endTimeUnixNano": str(run["end_ns"]),
            "attributes": llm_attrs,
            "status": {"code": 1 if run["terminal_outcome"] == "succeeded" else 0},
        },
    ]


def assert_otlp_response(status: int, body: bytes) -> None:
    detail = body.strip()
    if status < 200 or status >= 300:
        message = detail.decode("utf-8", errors="replace")[:500]
        suffix = f": {message}" if message else ""
        raise RuntimeError(
            f"OTLP ingest rejected the request with HTTP {status}{suffix}"
        )
    if not detail:
        return

    try:
        payload = json.loads(detail)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"OTLP ingest returned invalid JSON after HTTP {status}."
        ) from error
    if not isinstance(payload, dict):
        raise RuntimeError("OTLP ingest returned a non-object response.")

    partial_success = payload.get("partialSuccess")
    if partial_success is None:
        return
    if not isinstance(partial_success, dict):
        raise RuntimeError("OTLP ingest returned invalid partialSuccess metadata.")

    rejected_value = partial_success.get("rejectedSpans", "0")
    if isinstance(rejected_value, bool):
        raise RuntimeError(
            "OTLP partialSuccess.rejectedSpans must be a non-negative integer."
        )
    if isinstance(rejected_value, int) and rejected_value >= 0:
        rejected_spans = rejected_value
    elif isinstance(rejected_value, str) and rejected_value.isdecimal():
        rejected_spans = int(rejected_value)
    else:
        raise RuntimeError(
            "OTLP partialSuccess.rejectedSpans must be a non-negative integer."
        )

    error_message = partial_success.get("errorMessage")
    if error_message is not None and not isinstance(error_message, str):
        raise RuntimeError("OTLP partialSuccess.errorMessage must be a string.")
    if rejected_spans > 0:
        suffix = f": {error_message[:500]}" if error_message else ""
        raise RuntimeError(
            f"OTLP ingest rejected {rejected_spans} spans despite HTTP {status}{suffix}"
        )


def ship(spans: list[dict]) -> None:
    if not API_KEY:
        raise RuntimeError("TANGLE_API_KEY is required.")
    body = json.dumps(
        {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [
                            {
                                "key": "service.name",
                                "value": {"stringValue": "agno-agent"},
                            }
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
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            assert_otlp_response(response.status, response.read())
    except urllib.error.HTTPError as error:
        detail = error.read(500).decode("utf-8", errors="replace").strip()
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(
            f"OTLP ingest rejected the request with HTTP {error.code}{suffix}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OTLP ingest request failed: {error.reason}") from error
    except (TimeoutError, OSError) as error:
        raise RuntimeError(f"OTLP ingest request failed: {error}") from error


if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("Set TANGLE_API_KEY before running this live example.")
    scenarios = [
        ("exact-alpha", "Reply with exactly ALPHA and nothing else.", "ALPHA"),
        ("exact-beta", "Reply with exactly BETA and nothing else.", "BETA"),
        ("exact-gamma", "Reply with exactly GAMMA and nothing else.", "GAMMA"),
    ]
    all_spans: list[dict] = []
    for scenario_id, prompt, expected in scenarios:
        all_spans += otlp_spans_for_run(run_agno_agent(scenario_id, prompt, expected))
    ship(all_spans)
    print(f"Delivered {len(all_spans)} spans from Agno to Tangle Intelligence.")
