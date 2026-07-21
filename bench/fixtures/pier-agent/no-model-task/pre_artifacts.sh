#!/usr/bin/env bash
set -euo pipefail

mkdir -p /logs/artifacts
cd /app
git -c safe.directory=/app diff --binary benchmark-base..HEAD > /logs/artifacts/model.patch
