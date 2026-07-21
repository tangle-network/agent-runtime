#!/usr/bin/env bash
# Self-repro verify for django__django-11532 — AUTHORED FROM THE PROBLEM
# STATEMENT ONLY (honesty firewall: gold patch never read by the author; it is
# applied mechanically by calibration). Exit 0 = fixed, nonzero = bug present.
#
# Issue: email messages crash with UnicodeEncodeError when the hostname
# (DNS_NAME) is non-ASCII and the email encoding is non-unicode
# (iso-8859-1); the domain should be converted to punycode. The issue's own
# acceptance test: with DNS_NAME patched to "漢字", the Message-ID header must
# contain the punycode form 'xn--p8s937b'.
set -euo pipefail
IMG="swebench/sweb.eval.x86_64.django_1776_django-11532:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/repro.py" <<'PY'
import sys
from unittest.mock import patch

from django.conf import settings

settings.configure()

from django.core.mail import EmailMessage

# Simulate the issue's exact trigger — "Set hostname to non iso-8859-1 value
# (i.e. hostname 正宗)" — at its true source: DNS_NAME lazily derives the
# domain from socket.getfqdn() on first use, so patching getfqdn BEFORE the
# first message build runs the full production path through whatever
# conversion the fix adds.
try:
    with patch('socket.getfqdn', return_value='漢字'):
        email = EmailMessage('subject', '', 'from@example.com', ['to@example.com'])
        email.encoding = 'iso-8859-1'
        message = email.message()
        msgid = str(message['Message-ID'])
        print("Message-ID:", msgid)
        if 'xn--p8s937b' in msgid:
            print("VERIFY PASS: non-ASCII hostname converted to punycode in Message-ID")
            sys.exit(0)
        print("VERIFY FAIL: Message-ID does not contain the punycode domain")
        sys.exit(1)
except UnicodeEncodeError as e:
    print("VERIFY FAIL: UnicodeEncodeError (bug present):", e)
    sys.exit(1)
PY
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && timeout -s KILL 180 env PYTHONPATH=/testbed python /repro/repro.py'
