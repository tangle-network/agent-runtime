"""Evaluator-owned process isolation for one Pier candidate invocation."""

from __future__ import annotations

import secrets
import shlex
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pier.environments.base import BaseEnvironment

from .candidate_contract import sha256_bytes


class ProcessBoundaryHost(Protocol):
    async def _exec(
        self, environment: BaseEnvironment, command: str, **kwargs: Any
    ) -> Any: ...

    async def _ensure_real_directory(
        self, environment: BaseEnvironment, path: str, *, anchor: str, mode: int = 0o755
    ) -> None: ...

    async def _assert_real_directory(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        label: str,
        user: str | int | None = "root",
    ) -> None: ...

    async def _write_verified_file(
        self,
        environment: BaseEnvironment,
        source: Path,
        target: str,
        *,
        anchor: str,
        mode: int,
        digest: str,
        byte_length: int,
    ) -> None: ...


@dataclass(frozen=True)
class ProcessBoundaryConfig:
    uid: int
    gid: int
    evaluator_root: str
    control_root: str
    home: str
    temporary: str
    isolate_user: bool = True


class CandidateProcessBoundary:
    def __init__(self, host: ProcessBoundaryHost, config: ProcessBoundaryConfig):
        self._host = host
        self.config = config

    async def prepare_identity(
        self, environment: BaseEnvironment, workspace_roots: tuple[str, ...]
    ) -> None:
        config = self.config
        await self._host._ensure_real_directory(
            environment, config.evaluator_root, anchor="/", mode=0o755
        )
        await self._host._exec(
            environment,
            f"chmod 0755 -- {shlex.quote(config.evaluator_root)}",
            user="root",
        )
        for path, mode in (
            (config.control_root, 0o700),
            (config.home, 0o700),
            (config.temporary, 0o700),
        ):
            await self._host._ensure_real_directory(
                environment, path, anchor="/", mode=mode
            )
            await self._host._exec(
                environment,
                f"chmod {mode:o} -- {shlex.quote(path)}",
                user="root",
            )
        if not config.isolate_user:
            return
        await self._host._exec(
            environment,
            "\n".join(
                [
                    "set -eu",
                    "command -v setsid >/dev/null",
                    "command -v setpriv >/dev/null",
                    f"! grep -l '^Uid:[[:space:]]*{config.uid}[[:space:]]' "
                    "/proc/[0-9]*/status >/dev/null 2>&1",
                    f"chown {config.uid}:{config.gid} -- "
                    f"{shlex.quote(config.home)} {shlex.quote(config.temporary)}",
                    f"chown -R {config.uid}:{config.gid} -- "
                    + " ".join(shlex.quote(root) for root in workspace_roots),
                ]
            ),
            user="root",
        )

    async def stage_wrapper(self, environment: BaseEnvironment) -> tuple[str, str]:
        token = secrets.token_hex(24)
        wrapper = f"{self.config.control_root}/run-{token}.sh"
        marker = f"{self.config.control_root}/timeout-{token}"
        raw = self._runner_script()
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            handle.write(raw)
            local_path = Path(handle.name)
        try:
            await self._host._write_verified_file(
                environment,
                local_path,
                wrapper,
                anchor=self.config.control_root,
                mode=0o700,
                digest=sha256_bytes(raw),
                byte_length=len(raw),
            )
        finally:
            local_path.unlink(missing_ok=True)
        return wrapper, marker

    async def kill_and_wait(self, environment: BaseEnvironment) -> None:
        """Kill every process in the candidate identity and prove none remain."""
        if not self.config.isolate_user:
            return
        command = """set -eu
candidate_pids() {
  for status in /proc/[0-9]*/status; do
    test -r "$status" || continue
    pid=${status#/proc/}
    pid=${pid%/status}
    while IFS=: read -r key value; do
      if test "$key" = Uid; then
        set -- $value
        if test "${1:-}" = "$TARGET_UID"; then
          printf '%s\n' "$pid"
        fi
        break
      fi
    done < "$status"
  done
}

for attempt in $(seq 1 100); do
  pids=$(candidate_pids)
  test -n "$pids" || exit 0
  for pid in $pids; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  sleep 0.02
done
remaining=$(candidate_pids)
test -z "$remaining" || {
  printf 'candidate processes survived SIGKILL: %s\n' "$remaining" >&2
  exit 1
}
"""
        await self._host._exec(
            environment,
            command,
            env={"TARGET_UID": str(self.config.uid)},
            user="root",
            timeout_sec=5,
        )

    async def remove_control_files(
        self,
        environment: BaseEnvironment,
        wrapper: str | None,
        marker: str | None,
    ) -> None:
        paths = [path for path in (wrapper, marker) if path is not None]
        if not paths:
            return
        await self._host._assert_real_directory(
            environment,
            self.config.control_root,
            label="candidate control directory",
        )
        await self._host._exec(
            environment,
            "rm -f -- " + " ".join(shlex.quote(path) for path in paths),
            user="root",
        )

    async def timeout_marker_exists(
        self, environment: BaseEnvironment, marker: str
    ) -> bool:
        quoted = shlex.quote(marker)
        result = await self._host._exec(
            environment,
            f'test -f {quoted} && test ! -L {quoted} && test "$(cat -- {quoted})" = timeout',
            user="root",
            check=False,
        )
        return result.return_code == 0

    def _runner_script(self) -> bytes:
        if not self.config.isolate_user:
            return b"""#!/bin/sh
set -eu
marker=$1
uid=$2
gid=$3
deadline=$4
grace=$5
stdin_path=$6
shift 6
rm -f -- "$marker" "$marker.tmp"
set +e
if test "$stdin_path" = -; then
  timeout --signal=TERM --kill-after="${grace}s" "${deadline}s" env "$@"
else
  timeout --signal=TERM --kill-after="${grace}s" "${deadline}s" env "$@" < "$stdin_path"
fi
status=$?
set -e
if test "$status" = 124; then
  printf timeout > "$marker"
fi
exit "$status"
"""
        return b"""#!/bin/sh
set -eu
marker=$1
uid=$2
gid=$3
deadline=$4
grace=$5
stdin_path=$6
shift 6
rm -f -- "$marker" "$marker.tmp"

kill_candidate_uid() {
  signal=$1
  for status in /proc/[0-9]*/status; do
    test -r "$status" || continue
    pid=${status#/proc/}
    pid=${pid%/status}
    while IFS=: read -r key value; do
      if test "$key" = Uid; then
        set -- $value
        if test "${1:-}" = "$uid"; then
          kill "-$signal" "$pid" 2>/dev/null || true
        fi
        break
      fi
    done < "$status"
  done
}

candidate_uid_is_dead() {
  for status in /proc/[0-9]*/status; do
    test -r "$status" || continue
    while IFS=: read -r key value; do
      if test "$key" = Uid; then
        set -- $value
        test "${1:-}" = "$uid" && return 1
        break
      fi
    done < "$status"
  done
  return 0
}

kill_and_wait_candidate_uid() {
  kill_candidate_uid KILL
  attempt=0
  while ! candidate_uid_is_dead; do
    attempt=$((attempt + 1))
    test "$attempt" -lt 100 || {
      printf 'candidate processes survived SIGKILL\n' >&2
      return 1
    }
    kill_candidate_uid KILL
    sleep 0.02
  done
}

if test "$stdin_path" = -; then
  setsid setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --pdeathsig=KILL -- env "$@" &
else
  setsid setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --pdeathsig=KILL -- env "$@" < "$stdin_path" &
fi
candidate_pid=$!
(
  sleep "$deadline"
  if kill -0 "$candidate_pid" 2>/dev/null; then
    umask 077
    printf timeout > "$marker.tmp"
    mv -fT -- "$marker.tmp" "$marker"
    kill_candidate_uid TERM
    sleep "$grace"
    kill_and_wait_candidate_uid
  fi
) &
watchdog_pid=$!

set +e
wait "$candidate_pid"
candidate_status=$?
set -e
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
kill_and_wait_candidate_uid
if test -f "$marker"; then
  exit 124
fi
exit "$candidate_status"
"""
