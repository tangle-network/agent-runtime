"""Refine-aware Terminal-Bench agent.

Subclasses Terminal-Bench's native `OpenCodeAgent` so the agent, the in-container
install, the router auth, and the task's own verifier are all the published
open-source path — unchanged. The ONLY added behavior is an evidence-gated refine
directive prepended to the task instruction when a prior attempt is present.

Round 1 of the runner passes no prior attempt (or an empty one), so this agent is
byte-for-byte the plain opencode agent and round 1 == a real blind tb run. On a
refine round the runner passes the prior attempt (a summary of the failed round +
the failing tests); this class injects the directive and otherwise runs opencode
exactly as the base agent does (same `_run_agent_commands`, same env).

The prior attempt is passed as `prior_attempt_hex` — a hex-encoded UTF-8 string
with a leading 'h' sentinel. tb's CLI parses `--agent-kwarg key=value` with a
naive `key, value = kwarg.split("=")` and then runs `ast.literal_eval(value)`, so
the value must contain no '=' and must not look like a Python literal. Hex with an
'h' prefix satisfies both: no '=', and `literal_eval('h46...')` raises, so tb keeps
it as a string. The agent strips 'h' and decodes back to the original text.

Usage:
    tb run -d terminal-bench-core==0.1.1 \
      --agent-import-path tb_agents.opencode_refine_agent:OpenCodeRefineAgent \
      -m deepseek/deepseek-v4-pro --task-id <id> \
      --agent-kwarg prior_attempt_hex=h<hex-of-utf8-text>
"""

import inspect
import os
import tempfile
from pathlib import Path

from terminal_bench.agents.base_agent import AgentResult
from terminal_bench.agents.installed_agents.opencode.opencode_agent import (
    OpenCodeAgent,
)
from terminal_bench.terminal.tmux_session import TmuxSession
from terminal_bench.utils.template_utils import render_setup_script

REFINE_DIRECTIVE = (
    "REFINE PASS — your PREVIOUS attempt at this exact task FAILED the task's "
    "automated tests. Evidence from that attempt is below.\n\n"
    "<previous_attempt>\n{prior}\n</previous_attempt>\n\n"
    "Re-examine the task from scratch in this fresh container. Keep whatever the "
    "previous attempt got right, and fix the CONCRETE failure shown in the "
    "evidence — do not repeat the same mistake. Do NOT rewrite or discard a part "
    "that already worked. When done, verify your work against the task's stated "
    "success criteria before finishing.\n\n"
    "--- ORIGINAL TASK ---\n{instruction}"
)


class OpenCodeRefineAgent(OpenCodeAgent):
    """OpenCodeAgent + an evidence-gated refine-instruction injection.

    `prior_attempt_hex` is decoded + consumed here and never forwarded to the base
    agent, which only knows `model_name` / `version`. An empty/absent value degrades
    the agent exactly to the plain opencode agent.
    """

    def __init__(
        self,
        model_name: str,
        prior_attempt_hex: str | None = None,
        **kwargs,
    ):
        super().__init__(model_name, **kwargs)
        self._prior_attempt = self._decode_prior(prior_attempt_hex)

    @staticmethod
    def _decode_prior(prior_attempt_hex: str | None) -> str:
        if not prior_attempt_hex:
            return ""
        raw = str(prior_attempt_hex).strip()
        if raw.startswith("h"):
            raw = raw[1:]
        if not raw:
            return ""
        try:
            return bytes.fromhex(raw).decode("utf-8").strip()
        except ValueError as e:
            raise ValueError(
                f"prior_attempt_hex must be 'h' + hex-encoded UTF-8; got {raw[:40]!r}"
            ) from e

    @staticmethod
    def name() -> str:
        return "agent-runtime-opencode-refine"

    @property
    def _install_agent_script_path(self) -> os.PathLike:
        # The base method resolves the setup template via inspect.getfile(self.__class__),
        # which points at THIS subclass's dir (tb_agents/) where the template does not
        # live. Render opencode-setup.sh.j2 from the base OpenCodeAgent's own directory.
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

    def perform_task(
        self,
        instruction: str,
        session: TmuxSession,
        logging_dir: Path | None = None,
    ) -> AgentResult:
        if self._prior_attempt:
            instruction = REFINE_DIRECTIVE.format(
                prior=self._prior_attempt, instruction=instruction
            )
        return super().perform_task(instruction, session, logging_dir)
