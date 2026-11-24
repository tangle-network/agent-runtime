#!/bin/sh
# Harvey LAB's sandbox, from the publisher checkout: the image its own fallback builds (lab_core/sandbox/Dockerfile at the
# pinned commit, never the moving ghcr.io/harveyai/lab-sandbox:latest), tagged by commit and recorded in .agent-bench/sandbox-image.
# The harness drives podman. On a host with docker and no podman, .agent-bench/bin/podman runs the same subcommands through
# docker, adding --user <host uid:gid> to `run`: rootless podman maps the host user to the container's root, and without it
# docker's root, with every capability dropped, cannot write the host-owned workspace.
set -eu
mkdir -p .agent-bench/bin
if ! command -v podman >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || { echo "harvey-lab-sandbox: Harvey LAB needs podman or docker" >&2; exit 1; }
  cat > .agent-bench/bin/podman <<'SH'
#!/bin/sh
if [ "$1" = run ]; then shift; exec docker run --user "$(id -u):$(id -g)" "$@"; fi
exec docker "$@"
SH
  chmod +x .agent-bench/bin/podman
fi
PATH="$PWD/.agent-bench/bin:$PATH"
tag="agent-bench/lab-sandbox:$(git rev-parse --short=12 HEAD)"
podman image inspect "$tag" >/dev/null 2>&1 || podman build -q -f lab_core/sandbox/Dockerfile -t "$tag" lab_core/sandbox
echo "$tag" > .agent-bench/sandbox-image
