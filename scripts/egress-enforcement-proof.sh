#!/usr/bin/env bash
#
# Executable proof that a network policy is enforced rather than merely recorded.
#
# Stands up the same two-ring boundary the sandbox SDK builds — an internal (no-NAT) network so
# the only route out is the proxy, plus a domain-allowlisting proxy that decides — and runs the
# probe program from src/runtime/egress/probe.ts inside it.
#
# Two arms, and the second is not optional:
#   ENFORCED  policy allowlists the model host only. Graded clone must fail, model must answer.
#   CONTROL   no policy at all. The identical probe must SUCCEED at the graded clone.
#
# Without CONTROL, a probe that fails because the image lacks git, or because a stale AEG* chain
# from a dead sandbox is silently dropping traffic, reads as a pass.
#
# Subnets are pinned outside the range used by the host's leftover AEG* chains: those chains are
# keyed on container IPs that Docker reassigns, so an unpinned proof can be graded by someone
# else's dead firewall rule.
set -euo pipefail

MODEL_HOST="${EGRESS_PROOF_MODEL_HOST:-router.tangle.tools}"
GRADED_REPO="${EGRESS_PROOF_GRADED_REPO:-https://github.com/psf/requests.git}"
PREFIX="egress-proof-$$"
INTERNAL_NET="${PREFIX}-internal"
UPSTREAM_NET="${PREFIX}-upstream"
PROXY_NAME="${PREFIX}-proxy"
IMAGE="egress-probe:local"
WORK="$(mktemp -d)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  docker rm -f "$PROXY_NAME" >/dev/null 2>&1 || true
  docker network rm "$INTERNAL_NET" >/dev/null 2>&1 || true
  docker network rm "$UPSTREAM_NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== generating probe program from src/runtime/egress/probe.ts =="
node --experimental-strip-types "$ROOT/scripts/print-egress-probe.ts" \
  --allowed "$MODEL_HOST" --graded "$GRADED_REPO" > "$WORK/probe.sh"
wc -l < "$WORK/probe.sh" | xargs echo "probe program lines:"

echo "== building probe image (git + curl + bash present, so no check is vacuous) =="
cat > "$WORK/Dockerfile" <<'EOF'
FROM alpine:latest
RUN apk add --no-cache curl git bash ca-certificates
EOF
docker build -q -t "$IMAGE" "$WORK" >/dev/null

echo "== ARM ENFORCED: internal network + allowlisting proxy =="
docker network create --internal --subnet 172.31.240.0/24 "$INTERNAL_NET" >/dev/null
docker network create --subnet 172.31.241.0/24 "$UPSTREAM_NET" >/dev/null

# The image's shipped squid.conf already ends in `http_access deny all` and includes conf.d/*.conf
# ahead of it. Adding the allowlist there keeps the default-deny tail authoritative instead of
# replacing a config whose last line is the thing doing the enforcing.
cat > "$WORK/allowlist.conf" <<EOF
acl allowed_model dstdomain $MODEL_HOST
http_access allow allowed_model
EOF

# ubuntu/squid ships conf.d/debian.conf with a blanket `http_access allow localnet`, which loads
# AFTER allowlist.conf and allows every RFC1918 source — i.e. every container — to reach anything.
# The first run of this proof tunnelled github.com through a proxy that was "configured" with a
# one-domain allowlist. Neutralise it, or the allowlist is decoration.
printf 'logfile_rotate 0\n' > "$WORK/debian.conf"

docker run -d --name "$PROXY_NAME" --network "$UPSTREAM_NET" \
  -v "$WORK/allowlist.conf:/etc/squid/conf.d/allowlist.conf:ro" \
  -v "$WORK/debian.conf:/etc/squid/conf.d/debian.conf:ro" ubuntu/squid:latest >/dev/null
docker network connect --alias proxy "$INTERNAL_NET" "$PROXY_NAME"
ready=no
for _ in $(seq 1 40); do
  if docker logs "$PROXY_NAME" 2>&1 | grep -q 'Accepting HTTP'; then ready=yes; break; fi
  if [ "$(docker inspect -f '{{.State.Status}}' "$PROXY_NAME")" = "exited" ]; then break; fi
  sleep 1
done
if [ "$ready" != "yes" ]; then
  echo "proxy never became ready — refusing to grade an arm whose enforcer is not running" >&2
  docker logs "$PROXY_NAME" 2>&1 | tail -20 >&2
  exit 1
fi

set +e
docker run --rm --network "$INTERNAL_NET" \
  -e HTTP_PROXY="http://proxy:3128" -e HTTPS_PROXY="http://proxy:3128" \
  -e http_proxy="http://proxy:3128" -e https_proxy="http://proxy:3128" \
  -v "$WORK/probe.sh:/probe.sh:ro" "$IMAGE" sh /probe.sh > "$WORK/enforced.txt" 2>&1
set -e
echo "--- enforced arm probe records ---"
grep '^EGRESS-PROBE' "$WORK/enforced.txt" || echo "(none)"

echo "--- proxy access log (enforcer-side evidence; zero lines means the proxy was bypassed) ---"
docker logs "$PROXY_NAME" 2>&1 | grep -E 'TCP_(DENIED|TUNNEL|MISS)' | tail -20 || echo "(none)"

echo "== ARM CONTROL: no policy, same probe, same image =="
set +e
docker run --rm -v "$WORK/probe.sh:/probe.sh:ro" "$IMAGE" sh /probe.sh > "$WORK/control.txt" 2>&1
set -e
echo "--- control arm probe records ---"
grep '^EGRESS-PROBE' "$WORK/control.txt" || echo "(none)"

echo "== VERDICT =="
node --experimental-strip-types "$ROOT/scripts/grade-egress-probe.ts" \
  --enforced "$WORK/enforced.txt" --control "$WORK/control.txt"
