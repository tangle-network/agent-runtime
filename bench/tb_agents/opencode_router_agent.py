"""Router-aware, metered Terminal-Bench agent for the supervisor-vs-raw A/B.

Both arms of the harness-at-fixed-model A/B run opencode inside the Terminal-Bench
task container. The stock `OpenCodeAgent` cannot serve that A/B for two independent
reasons, both fixed here:

  1. Routing. The target model id is provider-qualified — `zai-coding-plan/glm-5.2`
     (and peers). opencode's built-in `zai-coding-plan` / `deepseek` / ... providers
     point at each vendor's own API, NOT the Tangle router. The stock agent's `_env`
     whitelist also raises `ValueError("Unknown provider zai-coding-plan")` for any
     provider it doesn't hard-code, and for the `openai` provider it forwards only
     `OPENAI_API_KEY`, never `OPENAI_BASE_URL`, so the router base url never reaches
     the container. This agent injects an opencode.json (via `OPENCODE_CONFIG`) that
     redefines the model's provider as an `@ai-sdk/openai-compatible` provider whose
     `baseURL` is the Tangle router and whose `apiKey` is the router key — so
     `opencode --model <provider>/<model> run ...` routes through the router for ANY
     provider, with zero per-provider special-casing.

  2. Metering. The stock agent runs opencode via a tmux `send_keys` command and
     returns `AgentResult(total_input_tokens=0, total_output_tokens=0)` — the harness
     then records zeros. This agent runs `opencode ... --format json`, redirects the
     event stream to a file in the container, reads it back over the docker exec
     channel, sums the per-message token usage, and returns a REAL
     `AgentResult(total_input_tokens=N, total_output_tokens=M)`.

Everything else — the in-container npm install of opencode, the task's own published
verifier — is the unchanged open-source path.

The container id the tb verifier grades is published to a host file (path in
`TB_CONTAINER_ID_FILE`, default `<cwd>/.tb-container-id`) so a downstream worker
executor (arm B) can `docker exec` into the SAME container. This is best-effort and
never fails the task.

Usage:
    tb run -d terminal-bench-core==0.1.1 -t crack-7z-hash.easy \
      --agent-import-path tb_agents.opencode_router_agent:OpenCodeRouterAgent \
      -m zai-coding-plan/glm-5.2 --output-path <dir> --run-id <id>

Env (forwarded from the tb-launching process, e.g. via dotenvx):
    OPENAI_API_KEY   router key (required)
    OPENAI_BASE_URL  router base url (optional; defaults to the Tangle router /v1)
"""

import inspect
import json
import os
import shlex
import tempfile
from pathlib import Path

from terminal_bench.agents.base_agent import AgentResult
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.agents.installed_agents.opencode.opencode_agent import (
    OpenCodeAgent,
)
from terminal_bench.terminal.tmux_session import TmuxSession
from terminal_bench.utils.logger import logger
from terminal_bench.utils.template_utils import render_setup_script

DEFAULT_ROUTER_BASE_URL = "https://router.tangle.tools/v1"

# All paths live under the container dir the base install flow already creates.
_CONTAINER_DIR = "/installed-agent"
_CONFIG_PATH = f"{_CONTAINER_DIR}/opencode-router.json"
_USAGE_OUT_PATH = f"{_CONTAINER_DIR}/opencode-events.jsonl"
_USAGE_ERR_PATH = f"{_CONTAINER_DIR}/opencode-run.err"


class OpenCodeRouterAgent(OpenCodeAgent):
    """`OpenCodeAgent` + Tangle-router routing + real token metering.

    Subclasses the published opencode agent so the install script, the tmux run
    machinery, and the task verifier are all the stock open-source path. The added
    behavior is confined to: (a) an injected provider config that points the model's
    provider at the router, (b) forwarding the router key + base url into the
    container env, and (c) capturing + parsing opencode's `--format json` usage into
    a real `AgentResult`.
    """

    def __init__(self, model_name: str, *args, **kwargs):
        # The stock __init__ does `self._provider, _ = model_name.split("/")`, which
        # raises on a 3-segment or bare id. Derive the provider robustly ourselves,
        # then hand the base class a value it can split without raising.
        self._model_name = model_name
        provider, _, sub = model_name.partition("/")
        self._provider = provider
        # Model id opencode sees, minus the provider segment (e.g. "glm-5.2").
        self._provider_model = sub or provider
        self._router_base_url = (
            os.environ.get("OPENAI_BASE_URL")
            or os.environ.get("ROUTER_BASE_URL")
            or DEFAULT_ROUTER_BASE_URL
        )
        self._router_api_key = os.environ.get("OPENAI_API_KEY", "")
        # Call the grandparent (AbstractInstalledAgent) init via OpenCodeAgent, but
        # avoid the base split-crash by not delegating provider derivation to it.
        super(OpenCodeAgent, self).__init__(*args, **kwargs)
        self._version = kwargs.get("version", "latest")
        self._logger = logger.getChild(__name__)

    @staticmethod
    def name() -> str:
        return "agent-runtime-opencode-router"

    @property
    def _install_agent_script_path(self) -> os.PathLike:
        """Render opencode's install template.

        The base `_get_templated_script_path` resolves the template relative to
        `inspect.getfile(self.__class__)` — i.e. next to THIS subclass file, where
        `opencode-setup.sh.j2` does not exist. Resolve it from the stock
        `OpenCodeAgent`'s own directory instead (same fix as OpenCodeRefineAgent).
        """
        template_path = (
            Path(inspect.getfile(OpenCodeAgent)).parent / "opencode-setup.sh.j2"
        )
        script_content = render_setup_script(
            template_path, self._get_template_variables()
        )
        temp_file = tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False)
        temp_file.write(script_content)
        temp_file.close()
        os.chmod(temp_file.name, 0o755)
        return Path(temp_file.name)

    @property
    def _env(self) -> dict[str, str]:
        """Forward the router credential + base url + config path into the container.

        Overrides the stock provider whitelist entirely: routing is done by the
        injected provider config (openai-compatible -> router), so the container only
        needs the router key, the router base url, and the OPENCODE_CONFIG pointer.
        """
        env: dict[str, str] = {
            "OPENAI_API_KEY": self._router_api_key,
            "OPENAI_BASE_URL": self._router_base_url,
            "OPENCODE_CONFIG": _CONFIG_PATH,
        }
        # Pass through any provider-native key the user already exported, so the same
        # agent also works when pointed at a vendor endpoint rather than the router.
        for passthrough in (
            "ANTHROPIC_API_KEY",
            "DEEPSEEK_API_KEY",
            "GROQ_API_KEY",
            "ZAI_API_KEY",
        ):
            if passthrough in os.environ:
                env.setdefault(passthrough, os.environ[passthrough])
        return {k: v for k, v in env.items() if v}

    def _build_router_config(self) -> str:
        """opencode.json that redefines the model's provider to hit the router.

        `@ai-sdk/openai-compatible` makes opencode treat `<provider>/<model>` as a
        plain OpenAI-compatible chat call to `options.baseURL` with `options.apiKey`.
        The router then dispatches the provider-qualified model upstream.
        """
        config = {
            "$schema": "https://opencode.ai/config.json",
            # Headless benchmark runs cannot answer interactive permission prompts.
            # Keep this identical for raw and supervisor arms.
            "permission": {
                "edit": "allow",
                "bash": "allow",
                "webfetch": "allow",
                "read": "allow",
                "write": "allow",
                "external_directory": "allow",
            },
            "provider": {
                self._provider: {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": f"Tangle Router ({self._provider})",
                    "options": {
                        "baseURL": self._router_base_url,
                        "apiKey": self._router_api_key,
                    },
                    "models": {
                        self._provider_model: {"name": self._provider_model},
                    },
                }
            },
        }
        return json.dumps(config)

    def _run_agent_commands(self, instruction: str):
        """Same command as the stock agent, but `--format json` with the event
        stream captured to a file so we can meter token usage after the run."""
        from terminal_bench.terminal.models import TerminalCommand

        escaped_instruction = shlex.quote(instruction)
        command = (
            f"opencode --model {self._model_name} --format json "
            f"run {escaped_instruction} "
            f"> {_USAGE_OUT_PATH} 2> {_USAGE_ERR_PATH}"
        )
        return [
            TerminalCommand(
                command=command,
                min_timeout_sec=0.0,
                max_timeout_sec=float("inf"),
                block=True,
                append_enter=True,
            )
        ]

    def _write_config_to_container(self, session: TmuxSession) -> None:
        config_json = self._build_router_config()
        session.container.exec_run(
            [
                "sh",
                "-c",
                (
                    f"mkdir -p {_CONTAINER_DIR} && "
                    f"printf '%s' {shlex.quote(config_json)} > {_CONFIG_PATH}"
                ),
            ]
        )

    def _publish_container_id(self, session: TmuxSession) -> None:
        """Best-effort: write the graded container's id to a host file so a worker
        executor (arm B) can docker-exec into the SAME container. Never raises."""
        try:
            container_id = getattr(session.container, "id", None) or getattr(
                session.container, "short_id", None
            )
            if not container_id:
                return
            out_file = os.environ.get(
                "TB_CONTAINER_ID_FILE",
                str(Path.cwd() / ".tb-container-id"),
            )
            Path(out_file).write_text(str(container_id))
            self._logger.info(
                "Published tb container id %s -> %s", container_id, out_file
            )
        except Exception as e:  # noqa: BLE001 - metadata publish is never fatal
            self._logger.warning("Could not publish tb container id: %s", e)

    def _read_container_file(self, session: TmuxSession, path: str) -> str:
        result = session.container.exec_run(["cat", path])
        output = getattr(result, "output", result)
        if isinstance(output, tuple):  # demuxed (stdout, stderr)
            output = output[0] or b""
        if isinstance(output, bytes):
            return output.decode("utf-8", errors="replace")
        return str(output or "")

    def _parse_usage(self, raw: str) -> tuple[int, int]:
        """Sum per-message input/output token usage from opencode's json events.

        opencode `run --format json` emits a stream of JSON events. Token usage lands
        under a few shapes across versions:
          - ev["usage"]        = {input_tokens, output_tokens} | {prompt/completion}
          - ev["tokens"]       = {input, output} | {input_tokens, output_tokens}
          - ev["part"]["tokens"] / ev["info"]["tokens"] / ev["message"]["tokens"]

        We take the token dict per *assistant message* and sum across messages, keyed
        by message id so a message emitted multiple times (part.updated then
        updated) is counted once (last value wins). A final cumulative `usage` event,
        if present, is preferred over the summed per-message figures.
        """
        per_message: dict[str, tuple[int, int]] = {}
        final_usage: tuple[int, int] | None = None
        anonymous_total = [0, 0]
        anon_count = 0

        for line in raw.splitlines():
            line = line.strip()
            if not line or not (line.startswith("{") or line.startswith("[")):
                continue
            try:
                ev = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            events = ev if isinstance(ev, list) else [ev]
            for e in events:
                if not isinstance(e, dict):
                    continue
                tokens = self._extract_tokens(e)
                if tokens is None:
                    continue
                inp, out = tokens
                msg_id = self._message_id(e)
                etype = str(e.get("type", ""))
                if etype in (
                    "session.completed",
                    "run.completed",
                    "turn.completed",
                ) and (inp or out):
                    final_usage = (inp, out)
                elif msg_id:
                    per_message[msg_id] = (inp, out)
                elif inp or out:
                    anonymous_total[0] += inp
                    anonymous_total[1] += out
                    anon_count += 1

        if per_message:
            total_in = sum(v[0] for v in per_message.values())
            total_out = sum(v[1] for v in per_message.values())
            return total_in, total_out
        if final_usage is not None:
            return final_usage
        if anon_count:
            return anonymous_total[0], anonymous_total[1]
        return 0, 0

    @staticmethod
    def _message_id(e: dict) -> str:
        for container_key in ("info", "message", "part"):
            sub = e.get(container_key)
            if isinstance(sub, dict):
                for id_key in ("messageID", "message_id", "id"):
                    val = sub.get(id_key)
                    if isinstance(val, str) and val:
                        return val
        for id_key in ("messageID", "message_id"):
            val = e.get(id_key)
            if isinstance(val, str) and val:
                return val
        return ""

    @classmethod
    def _extract_tokens(cls, e: dict) -> tuple[int, int] | None:
        """Pull an (input, output) token pair from one event dict, if present."""
        # Search the event itself and one level of common nesting.
        candidates: list[dict] = [e]
        for key in ("usage", "tokens", "part", "info", "message"):
            sub = e.get(key)
            if isinstance(sub, dict):
                candidates.append(sub)
                for key2 in ("usage", "tokens"):
                    sub2 = sub.get(key2)
                    if isinstance(sub2, dict):
                        candidates.append(sub2)
        for c in candidates:
            pair = cls._token_pair(c)
            if pair is not None:
                return pair
        return None

    @staticmethod
    def _token_pair(d: dict) -> tuple[int, int] | None:
        input_keys = ("input_tokens", "prompt_tokens", "input")
        output_keys = ("output_tokens", "completion_tokens", "output")
        inp = next(
            (d[k] for k in input_keys if isinstance(d.get(k), (int, float))), None
        )
        out = next(
            (d[k] for k in output_keys if isinstance(d.get(k), (int, float))), None
        )
        if inp is None and out is None:
            return None
        return int(inp or 0), int(out or 0)

    def perform_task(
        self,
        instruction: str,
        session: TmuxSession,
        logging_dir: Path | None = None,
    ) -> AgentResult:
        if not self._router_api_key:
            self._logger.error(
                "OPENAI_API_KEY (router key) is not set; opencode has no credential "
                "to reach the router."
            )
        # Publish container id + inject router config BEFORE the base flow runs the
        # agent. The base perform_task copies the install script into _CONTAINER_DIR,
        # sources setup-env.sh (which exports OPENCODE_CONFIG), installs opencode, and
        # runs the (json-capturing) command from _run_agent_commands.
        self._publish_container_id(session)
        self._write_config_to_container(session)

        base_result = super().perform_task(instruction, session, logging_dir)
        if base_result.failure_mode == FailureMode.AGENT_INSTALLATION_FAILED:
            return base_result

        raw_events = self._read_container_file(session, _USAGE_OUT_PATH)
        raw_err = self._read_container_file(session, _USAGE_ERR_PATH)
        # Persist the raw opencode event stream + stderr to the trajectory dir before
        # the container is torn down, so the token metering is auditable and the run
        # has a trajectory for the A/B. Best-effort — never fatal.
        if logging_dir is not None:
            try:
                logging_dir.mkdir(parents=True, exist_ok=True)
                (logging_dir / "opencode-events.jsonl").write_text(raw_events)
                (logging_dir / "opencode-run.err").write_text(raw_err)
            except Exception as e:  # noqa: BLE001 - trajectory dump is never fatal
                self._logger.warning("Could not persist opencode trajectory: %s", e)
        input_tokens, output_tokens = self._parse_usage(raw_events)
        if input_tokens == 0 and output_tokens == 0:
            self._logger.warning(
                "opencode reported zero usage; events=%d bytes, stderr tail: %s",
                len(raw_events),
                raw_err[-800:],
            )
        else:
            self._logger.info(
                "opencode usage: input=%d output=%d", input_tokens, output_tokens
            )
        return AgentResult(
            total_input_tokens=input_tokens,
            total_output_tokens=output_tokens,
            failure_mode=base_result.failure_mode,
        )
